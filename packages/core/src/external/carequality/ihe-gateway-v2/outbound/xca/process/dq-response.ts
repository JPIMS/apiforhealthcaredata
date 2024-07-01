import { XMLParser } from "fast-xml-parser";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import {
  OutboundDocumentQueryReq,
  OutboundDocumentQueryResp,
  DocumentReference,
  XCAGateway,
} from "@metriport/ihe-gateway-sdk";
import {
  handleRegistryErrorResponse,
  handleHttpErrorResponse,
  handleEmptyResponse,
  handleSchemaErrorResponse,
} from "./error";
import { DQSamlClientResponse } from "../send/dq-requests";
import { stripUrnPrefix } from "../../../../../../util/urn";
import {
  XDSDocumentEntryAuthor,
  XDSDocumentEntryClassCode,
  XDSDocumentEntryUniqueId,
} from "../../../../shared";
import { successStatus, partialSuccessStatus } from "./constants";
import { capture } from "../../../../../../util/notifications";
import { errorToString, toArray } from "@metriport/shared";
import { iti38Schema, Slot, ExternalIdentifier, Classification, ExtrinsicObject } from "./schema";
import { out } from "../../../../../../util/log";

dayjs.extend(utc);

const { log } = out("DQ Processing");

function getResponseHomeCommunityId(extrinsicObject: ExtrinsicObject): string {
  return stripUrnPrefix(extrinsicObject?._home);
}

function getHomeCommunityIdForDr(extrinsicObject: ExtrinsicObject): string {
  return getResponseHomeCommunityId(extrinsicObject);
}

function getCreationTime({
  creationTimeValue,
  serviceStartTimeValue,
  serviceStopTimeValue,
}: {
  creationTimeValue: string | undefined;
  serviceStartTimeValue: string | undefined;
  serviceStopTimeValue: string | undefined;
}): string | undefined {
  const time = creationTimeValue ?? serviceStartTimeValue ?? serviceStopTimeValue;

  try {
    return time ? dayjs.utc(time).toISOString() : undefined;
  } catch (error) {
    return undefined;
  }
}

export function parseDocumentReference({
  extrinsicObject,
  outboundRequest,
}: {
  extrinsicObject: ExtrinsicObject;
  outboundRequest: OutboundDocumentQueryReq;
}): DocumentReference | undefined {
  const slots = Array.isArray(extrinsicObject?.Slot)
    ? extrinsicObject?.Slot
    : [extrinsicObject?.Slot];
  const externalIdentifiers = Array.isArray(extrinsicObject?.ExternalIdentifier)
    ? extrinsicObject?.ExternalIdentifier
    : [extrinsicObject?.ExternalIdentifier];
  const classifications = Array.isArray(extrinsicObject?.Classification)
    ? extrinsicObject?.Classification
    : [extrinsicObject?.Classification];

  const findSlotValue = (name: string): string | undefined => {
    const slot = slots.find((slot: Slot) => slot._name === name);
    return slot ? String(slot.ValueList.Value) : undefined;
  };

  const findExternalIdentifierValue = (scheme: string): string | undefined => {
    const identifier = externalIdentifiers?.find(
      (identifier: ExternalIdentifier) => identifier._identificationScheme === scheme
    );
    return identifier ? identifier._value : undefined;
  };

  const findClassificationSlotValue = (
    classificationScheme: string,
    slotName: string
  ): string | undefined => {
    const classification = classifications.find(
      (c: Classification) => c._classificationScheme === classificationScheme
    );
    if (!classification) return undefined;

    const slotArray = toArray(classification.Slot);
    const classificationSlots = slotArray.flatMap((slot: Slot) => slot ?? []);

    const slot = classificationSlots.find((s: Slot) => s._name === slotName);
    return slot ? String(slot.ValueList.Value) : undefined;
  };

  const findClassificationName = (scheme: string): string | undefined => {
    const classification = classifications?.find(
      (classification: Classification) => classification?._classificationScheme === scheme
    );
    if (!classification) return undefined;
    const title = classification?.Name?.LocalizedString?._value;
    return title;
  };

  const sizeValue = findSlotValue("size");
  const repositoryUniqueId = findSlotValue("repositoryUniqueId");
  const docUniqueId = findExternalIdentifierValue(XDSDocumentEntryUniqueId);

  if (!repositoryUniqueId || !docUniqueId) {
    const msg = "Document Reference is missing repositoryUniqueId or docUniqueId";
    capture.error(msg, {
      extra: {
        extrinsicObject,
        outboundRequest,
      },
    });
    return undefined;
  }

  const creationTimeValue = findSlotValue("creationTime");
  const serviceStartTimeValue = findSlotValue("serviceStartTime");
  const serviceStopTimeValue = findSlotValue("serviceStopTime");

  const documentReference: DocumentReference = {
    homeCommunityId: getHomeCommunityIdForDr(extrinsicObject),
    repositoryUniqueId,
    docUniqueId: stripUrnPrefix(docUniqueId),
    contentType: extrinsicObject?._mimeType,
    language: findSlotValue("languageCode"),
    size: sizeValue ? parseInt(sizeValue) : undefined,
    title: findClassificationName(XDSDocumentEntryClassCode),
    creation: getCreationTime({ creationTimeValue, serviceStartTimeValue, serviceStopTimeValue }),
    authorInstitution: findClassificationSlotValue(XDSDocumentEntryAuthor, "authorInstitution"),
  };
  return documentReference;
}

function handleSuccessResponse({
  extrinsicObjects,
  outboundRequest,
  gateway,
}: {
  extrinsicObjects: ExtrinsicObject[];
  outboundRequest: OutboundDocumentQueryReq;
  gateway: XCAGateway;
}): OutboundDocumentQueryResp {
  const documentReferences = extrinsicObjects.flatMap(
    extrinsicObject => parseDocumentReference({ extrinsicObject, outboundRequest }) ?? []
  );

  const response: OutboundDocumentQueryResp = {
    id: outboundRequest.id,
    patientId: outboundRequest.patientId,
    timestamp: outboundRequest.timestamp,
    requestTimestamp: outboundRequest.timestamp,
    responseTimestamp: dayjs().toISOString(),
    gateway,
    documentReference: documentReferences,
    externalGatewayPatient: outboundRequest.externalGatewayPatient,
    iheGatewayV2: true,
  };
  return response;
}

export function processDqResponse({
  response: { response, success, gateway, outboundRequest },
}: {
  response: DQSamlClientResponse;
}): OutboundDocumentQueryResp {
  if (success === false) {
    return handleHttpErrorResponse({
      httpError: response,
      outboundRequest,
      gateway: gateway,
    });
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "_",
    textNodeName: "_text",
    parseAttributeValue: false,
    removeNSPrefix: true,
  });
  const jsonObj = parser.parse(response);

  try {
    const iti38Response = iti38Schema.parse(jsonObj);

    const status = iti38Response.Envelope.Body.AdhocQueryResponse._status.split(":").pop();
    const registryObjectList = iti38Response.Envelope.Body.AdhocQueryResponse.RegistryObjectList;
    const extrinsicObjects = registryObjectList ? registryObjectList.ExtrinsicObject : undefined;
    const registryErrorList = iti38Response.Envelope.Body.AdhocQueryResponse?.RegistryErrorList;

    if ((status === successStatus || status === partialSuccessStatus) && extrinsicObjects) {
      return handleSuccessResponse({
        extrinsicObjects: toArray(extrinsicObjects),
        outboundRequest,
        gateway,
      });
    } else if (registryErrorList) {
      return handleRegistryErrorResponse({
        registryErrorList,
        outboundRequest,
        gateway,
      });
    } else {
      return handleEmptyResponse({
        outboundRequest,
        gateway,
      });
    }
  } catch (error) {
    log(`Error processing DQ response ${JSON.stringify(jsonObj)}`);
    return handleSchemaErrorResponse({
      outboundRequest,
      gateway,
      text: errorToString(error),
    });
  }
}
