import { OperationOutcomeError } from "@medplum/core";
import {
  Bundle,
  BundleEntry,
  ExtractResource,
  OperationOutcomeIssue,
  Resource,
  ResourceType,
} from "@medplum/fhirtypes";
import {
  ConsolidatedQuery,
  GetConsolidatedFilters,
  resourcesSearchableByPatient,
  ResourceTypeForConsolidation,
} from "@metriport/api-sdk";
import { createMRSummaryFileName } from "@metriport/core/domain/medical-record-summary";
import { Patient } from "@metriport/core/domain/patient";
import { analytics, EventTypes } from "@metriport/core/external/analytics/posthog";
import {
  buildBundle,
  getReferencesFromResources,
} from "@metriport/core/external/fhir/shared/bundle";
import { isResourceDerivedFromDocRef } from "@metriport/core/external/fhir/shared/index";
import { uuidv7 } from "@metriport/core/util/uuid-v7";
import { emptyFunction } from "@metriport/shared";
import { elapsedTimeFromNow } from "@metriport/shared/common/date";
import { SearchSetBundle } from "@metriport/shared/medical";
import { intersection } from "lodash";
import { makeFhirApi } from "../../../external/fhir/api/api-factory";
import {
  fullDateQueryForResource,
  getPatientFilter,
} from "../../../external/fhir/patient/resource-filter";
import { getReferencesFromFHIR } from "../../../external/fhir/references/get-references";
import { Config } from "../../../shared/config";
import { capture } from "../../../shared/notifications";
import { Util } from "../../../shared/util";
import { getSignedURL } from "../document/document-download";
import { processConsolidatedDataWebhook } from "./consolidated-webhook";
import {
  buildDocRefBundleWithAttachment,
  emptyMetaProp,
  handleBundleToMedicalRecord,
  uploadJsonBundleToS3,
} from "./convert-fhir-bundle";
import { getPatientOrFail } from "./get-patient";
import { storeQueryInit } from "./query-init";

export type GetConsolidatedParams = {
  patient: Pick<Patient, "id" | "cxId" | "data">;
  requestId?: string;
  documentIds?: string[];
} & GetConsolidatedFilters;

export type GetConsolidatedSendToCxParams = GetConsolidatedParams & {
  requestId: string;
};

export type ConsolidatedQueryParams = {
  cxId: string;
  patientId: string;
  cxConsolidatedRequestMetadata?: unknown;
} & GetConsolidatedFilters;

export async function startConsolidatedQuery({
  cxId,
  patientId,
  resources = [],
  dateFrom,
  dateTo,
  conversionType,
  cxConsolidatedRequestMetadata,
}: ConsolidatedQueryParams): Promise<ConsolidatedQuery> {
  const { log } = Util.out(`startConsolidatedQuery - M patient ${patientId}`);
  const patient = await getPatientOrFail({ id: patientId, cxId });
  const currentConsolidatedProgress = getCurrentConsolidatedProgress(
    patient.data.consolidatedQueries,
    {
      resources,
      dateFrom,
      dateTo,
      conversionType,
    }
  );

  if (currentConsolidatedProgress) {
    log(
      `Patient ${patientId} consolidatedQuery is already 'processing' with params: ${currentConsolidatedProgress}, skipping...`
    );
    return currentConsolidatedProgress;
  }

  const startedAt = new Date();
  const requestId = uuidv7();
  const progress: ConsolidatedQuery = {
    requestId,
    status: "processing",
    startedAt,
    resources,
    dateFrom,
    dateTo,
    conversionType,
  };

  analytics({
    distinctId: patient.cxId,
    event: EventTypes.consolidatedQuery,
    properties: {
      patientId: patient.id,
      requestId,
    },
  });

  const updatedPatient = await storeQueryInit({
    id: patient.id,
    cxId: patient.cxId,
    cmd: {
      consolidatedQueries: appendProgressToProcessingQueries(
        patient.data.consolidatedQueries,
        progress
      ),
      cxConsolidatedRequestMetadata,
    },
  });

  getConsolidatedAndSendToCx({
    patient: updatedPatient,
    resources,
    dateFrom,
    dateTo,
    conversionType,
    requestId,
  }).catch(emptyFunction);

  return progress;
}

function appendProgressToProcessingQueries(
  currentConsolidatedQueries: ConsolidatedQuery[] | undefined,
  progress: ConsolidatedQuery
): ConsolidatedQuery[] {
  if (currentConsolidatedQueries) {
    const queriesInProgress = currentConsolidatedQueries.filter(
      query => query.status === "processing"
    );

    return [...queriesInProgress, progress];
  }

  return [progress];
}

export function getCurrentConsolidatedProgress(
  consolidatedQueriesProgress: ConsolidatedQuery[] | undefined,
  queryParams: GetConsolidatedFilters,
  progressStatus = "processing"
): ConsolidatedQuery | undefined {
  if (!consolidatedQueriesProgress) return undefined;

  const { resources, dateFrom, dateTo, conversionType } = queryParams;

  for (const progress of consolidatedQueriesProgress) {
    const isSameResources = getIsSameResources(resources, progress.resources);
    const isSameDateFrom = progress.dateFrom === dateFrom;
    const isSameDateTo = progress.dateTo === dateTo;
    const isSameConversionType = progress.conversionType === conversionType;
    const isProcessing = progress.status === progressStatus;

    if (isSameResources && isSameDateFrom && isSameDateTo && isSameConversionType && isProcessing) {
      return progress;
    }
  }
}

export function getIsSameResources(
  queryResources: ResourceTypeForConsolidation[] | undefined,
  currentResources: ResourceTypeForConsolidation[] | undefined
): boolean {
  const haveSameLength = queryResources?.length === currentResources?.length;
  const intersectedResources = intersection(queryResources, currentResources);
  const usingAllQueryResources = queryResources?.length === intersectedResources.length;

  const areQueryResourcesSearchableByPatient =
    intersection(queryResources, resourcesSearchableByPatient).length ===
    resourcesSearchableByPatient.length;
  const areQueryResourcesEmpty = !queryResources || queryResources.length === 0;

  const isCurrentProgressSearchableByPatient =
    intersection(currentResources, resourcesSearchableByPatient).length ===
    resourcesSearchableByPatient.length;
  const isCurrentProgressEmpty = !currentResources || currentResources.length === 0;

  return (
    (haveSameLength && usingAllQueryResources) ||
    (isCurrentProgressEmpty && areQueryResourcesSearchableByPatient) ||
    (areQueryResourcesEmpty && isCurrentProgressSearchableByPatient)
  );
}

async function getConsolidatedAndSendToCx(params: GetConsolidatedSendToCxParams): Promise<void> {
  const { patient, requestId, resources, dateFrom, dateTo, conversionType } = params;
  try {
    const { bundle, filters } = await getConsolidated(params);
    // trigger WH call
    processConsolidatedDataWebhook({
      patient,
      requestId,
      status: "completed",
      bundle,
      filters,
    }).catch(emptyFunction);
  } catch (error) {
    processConsolidatedDataWebhook({
      patient,
      requestId,
      status: "failed",
      filters: {
        resources: resources ? resources.join(", ") : undefined,
        dateFrom,
        dateTo,
        conversionType,
      },
    }).catch(emptyFunction);
  }
}

export async function getConsolidated({
  patient,
  documentIds,
  resources,
  dateFrom,
  dateTo,
  requestId,
  conversionType,
}: GetConsolidatedParams): Promise<{
  bundle: SearchSetBundle<Resource>;
  filters: Record<string, string | undefined>;
}> {
  const { log } = Util.out(`getConsolidated - cxId ${patient.cxId}, patientId ${patient.id}`);
  const filters = { resources: resources ? resources.join(", ") : undefined, dateFrom, dateTo };
  try {
    let bundle = await getConsolidatedPatientData({
      patient,
      documentIds,
      resources,
      dateFrom,
      dateTo,
    });

    bundle.entry = filterOutPrelimDocRefs(bundle.entry);
    const hasResources = bundle.entry && bundle.entry.length > 0;
    const shouldCreateMedicalRecord = conversionType && conversionType != "json" && hasResources;
    const currentConsolidatedProgress = patient.data.consolidatedQueries?.find(
      q => q.requestId === requestId
    );

    const defaultAnalyticsProps = {
      distinctId: patient.cxId,
      event: EventTypes.consolidatedQuery,
      properties: {
        patientId: patient.id,
        conversionType: "bundle",
        duration: elapsedTimeFromNow(currentConsolidatedProgress?.startedAt),
        resourceCount: bundle.entry?.length,
      },
    };

    analytics(defaultAnalyticsProps);

    if (shouldCreateMedicalRecord) {
      // If we need to convert to medical record, we also have to update the resulting
      // FHIR bundle to represent that.
      bundle = await handleBundleToMedicalRecord({
        bundle,
        patient,
        resources,
        dateFrom,
        dateTo,
        conversionType,
      });

      analytics({
        ...defaultAnalyticsProps,
        properties: {
          ...defaultAnalyticsProps.properties,
          duration: elapsedTimeFromNow(currentConsolidatedProgress?.startedAt),
          conversionType,
        },
      });
    }

    if (conversionType === "json" && hasResources) {
      return await uploadConsolidatedJsonAndReturnUrl({
        patient,
        bundle,
        filters,
      });
    }
    return { bundle, filters };
  } catch (error) {
    const msg = "Failed to get FHIR resources";
    log(`${msg}: ${JSON.stringify(filters)}`);
    capture.error(msg, {
      extra: {
        error,
        context: `getConsolidated`,
        patientId: patient.id,
        filters,
      },
    });
    throw error;
  }
}

export function filterOutPrelimDocRefs(
  entries: BundleEntry<Resource>[] | undefined
): BundleEntry<Resource>[] | undefined {
  if (!entries) return entries;

  return entries.filter(entry => {
    if (entry.resource?.resourceType === "DocumentReference") {
      const isValidStatus = entry.resource?.docStatus !== "preliminary";

      return isValidStatus;
    }

    return true;
  });
}

async function uploadConsolidatedJsonAndReturnUrl({
  patient,
  bundle,
  filters,
}: {
  patient: Pick<Patient, "id" | "cxId">;
  bundle: Bundle<Resource>;
  filters: Record<string, string | undefined>;
}): Promise<{
  bundle: SearchSetBundle<Resource>;
  filters: Record<string, string | undefined>;
}> {
  {
    const fileName = createMRSummaryFileName(patient.cxId, patient.id, "json");
    await uploadJsonBundleToS3({
      bundle,
      fileName,
      metadata: {
        patientId: patient.id,
        cxId: patient.cxId,
        resources: filters.resources?.toString() ?? emptyMetaProp,
        dateFrom: filters.dateFrom ?? emptyMetaProp,
        dateTo: filters.dateTo ?? emptyMetaProp,
        conversionType: filters.conversionType ?? emptyMetaProp,
      },
    });

    const signedUrl = await getSignedURL({
      bucketName: Config.getMedicalDocumentsBucketName(),
      fileName,
    });
    const newBundle = buildDocRefBundleWithAttachment(patient.id, signedUrl, "json");
    return { bundle: newBundle, filters };
  }
}

/**
 * Get consolidated patient data from FHIR server.
 *
 * @param documentIds (Optional) List of document reference IDs to filter by. If provided, only
 *            resources derived from these document references will be returned.
 * @returns FHIR bundle of resources matching the filters.
 */
export async function getConsolidatedPatientData({
  patient,
  documentIds = [],
  resources,
  dateFrom,
  dateTo,
}: {
  patient: Pick<Patient, "id" | "cxId">;
  documentIds?: string[];
  resources?: ResourceTypeForConsolidation[];
  dateFrom?: string;
  dateTo?: string;
}): Promise<SearchSetBundle<Resource>> {
  const { log } = Util.out(
    `getConsolidatedPatientData - cxId ${patient.cxId}, patientId ${patient.id}`
  );
  const { id: patientId, cxId } = patient;
  const {
    resourcesByPatient,
    resourcesBySubject,
    generalResourcesNoFilter,
    dateFilter: fullDateQuery,
  } = getPatientFilter({
    resources,
    dateFrom,
    dateTo,
  });
  log(`Getting consolidated data with resources by patient: ${resourcesByPatient.join(", ")}...`);
  log(`...and by subject: ${resourcesBySubject.join(", ")}`);
  documentIds.length > 0 && log(`...and document IDs: ${documentIds.join(", ")}`);
  log(`...and general resources with no specific filter: ${generalResourcesNoFilter.join(", ")}`);

  const fhir = makeFhirApi(cxId);
  const errorsToReport: Record<string, string> = {};

  const settled = await Promise.allSettled([
    ...resourcesByPatient.map(async resource => {
      const dateFilter = fullDateQueryForResource(fullDateQuery, resource);
      return searchResources(
        resource,
        () => fhir.searchResourcePages(resource, `patient=${patientId}${dateFilter}`),
        errorsToReport
      );
    }),
    ...resourcesBySubject.map(async resource => {
      const dateFilter = fullDateQueryForResource(fullDateQuery, resource);
      return searchResources(
        resource,
        () => fhir.searchResourcePages(resource, `subject=${patientId}${dateFilter}`),
        errorsToReport
      );
    }),
    // ...generalResourcesNoFilter.map(async resource => {
    //   return searchResources(resource, () => fhir.searchResourcePages(resource), errorsToReport);
    // }),
  ]);

  const success: Resource[] = settled.flatMap(s => (s.status === "fulfilled" ? s.value : []));

  const failuresAmount = Object.keys(errorsToReport).length;
  if (failuresAmount > 0) {
    log(
      `Failed to get FHIR resources (${failuresAmount} failures, ${
        success.length
      } succeeded): ${JSON.stringify(errorsToReport)}`
    );
    capture.message(`Failed to get FHIR resources`, {
      extra: {
        context: `getConsolidatedPatientData`,
        patientId,
        errorsToReport,
        succeeded: success.length,
        failed: failuresAmount,
      },
      level: "error",
    });
  }

  const filtered = filterByDocumentIds(success, documentIds, log);

  const { missingReferences } = getReferencesFromResources({
    resources: filtered,
  });
  const missingRefsOnFHIR = await getReferencesFromFHIR(missingReferences, fhir, log);

  const grouped = [...filtered, ...missingRefsOnFHIR];

  const entry: BundleEntry[] = grouped.map(r => ({ resource: r }));
  return buildBundle(entry);
}

function filterByDocumentIds(
  resources: Resource[],
  documentIds: string[],
  log = console.log
): Resource[] {
  const defaultMsg = `Got ${resources.length} resources from FHIR server`;
  if (documentIds.length <= 0) {
    log(`${defaultMsg}, not filtering by documentIds`);
    return resources;
  }
  const isDerivedFromDocRefs = (r: Resource) =>
    documentIds.some(id => isResourceDerivedFromDocRef(r, id));
  const filtered = documentIds.length > 0 ? resources.filter(isDerivedFromDocRefs) : resources;
  log(`${defaultMsg}, filtered by documentIds to ${filtered.length} resources`);
  return filtered;
}

const searchResources = async <K extends ResourceType>(
  resource: K,
  searchFunction: () => AsyncGenerator<ExtractResource<K>[]>,
  errorsToReport: Record<string, string>
) => {
  try {
    const pages: Resource[] = [];
    for await (const page of searchFunction()) {
      pages.push(...page);
    }
    return pages;
  } catch (err) {
    if (err instanceof OperationOutcomeError && err.outcome.id === "not-found") throw err;
    if (err instanceof OperationOutcomeError) errorsToReport[resource] = getMessage(err);
    else errorsToReport[resource] = String(err);
    throw err;
  }
};

function getMessage(err: OperationOutcomeError): string {
  return err.outcome.issue ? err.outcome.issue.map(issueToString).join(",") : "";
}

function issueToString(issue: OperationOutcomeIssue): string {
  return (
    issue.details?.text ??
    (issue.diagnostics ? issue.diagnostics.slice(0, 100) + "..." : null) ??
    JSON.stringify(issue)
  );
}
