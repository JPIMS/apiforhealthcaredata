import { OrganizationData, OrganizationBizType } from "@metriport/core/domain/organization";
import { uuidv7 } from "@metriport/core/util/uuid-v7";
import { UniqueConstraintError } from "sequelize";
import BadRequestError from "../../../errors/bad-request";
import { createTenantIfNotExists } from "../../../external/fhir/admin";
import { OrganizationModel } from "../../../models/medical/organization";
import { capture } from "../../../shared/notifications";
import { Util } from "../../../shared/util";
import { createOrganizationId } from "../customer-sequence/create-id";
import { getOrganization } from "./get-organization";
import { toFHIR } from "../../../external/fhir/organization";
import { upsertOrgToFHIRServer } from "../../../external/fhir/organization/upsert-organization";
import { CqMetriportDataDefault } from "../../../external/carequality/shared";
import cwCommands from "../../../external/commonwell";
import cqCommands from "../../../external/carequality";
import { getAddressWithCoordinates } from "../../../domain/medical/address";
import { processAsyncError } from "../../../errors";

const MAX_ATTEMPTS = 5;

type Identifier = Pick<OrganizationModel, "cxId">;
type OrganizationNoExternalData = Omit<OrganizationData, "externalData">;
export type OrganizationCreateCmd = OrganizationNoExternalData & Identifier;

export const createOrganization = async (
  orgData: OrganizationCreateCmd,
  orgType: OrganizationBizType = OrganizationBizType.healthcareProvider
): Promise<OrganizationModel> => {
  const { cxId } = orgData;

  // ensure we never create more than one org per customer
  const existingOrg = await getOrganization({ cxId });
  if (existingOrg) throw new BadRequestError(`Organization already exists for customer ${cxId}`);

  const org = await createOrganizationInternal(orgData, orgType);

  // create tenant on FHIR server
  await createTenantIfNotExists(org);

  const fhirOrg = toFHIR(org);
  await upsertOrgToFHIRServer(org.cxId, fhirOrg);

  if (org.type === "healthcare_provider") {
    // Intentionally asynchronous
    cwCommands.organization
      .create(cxId, {
        ...org,
        active: org.cwActive,
      })
      .catch(processAsyncError(`cw.org.create`));

    const locationWithCoordinates = await getAddressWithCoordinates(org.data.location, cxId);
    cqCommands.organization
      .createOrUpdate({
        oid: org.oid,
        name: org.data.name,
        ...locationWithCoordinates,
        lat: `${locationWithCoordinates.coordinates.lat}`,
        lon: `${locationWithCoordinates.coordinates.lon}`,
        postalCode: locationWithCoordinates.zip,
        organizationBizType: org.type,
        active: org.cwActive,
        ...CqMetriportDataDefault,
      })
      .catch(processAsyncError(`cq.org.create`));
  }

  return org;
};

async function createOrganizationInternal(
  orgData: OrganizationCreateCmd,
  orgType: OrganizationBizType = OrganizationBizType.healthcareProvider,
  attempt = 1
): Promise<OrganizationModel> {
  try {
    const { cxId, name, type, location } = orgData;

    const { oid, organizationNumber } = await createOrganizationId();

    const org = await OrganizationModel.create({
      id: uuidv7(),
      oid,
      type: orgType,
      organizationNumber,
      cxId,
      data: { name, type, location },
      cqActive: false,
      cwActive: true,
    });

    return org;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error instanceof UniqueConstraintError) {
      const msg = "Collision creating organization id";
      if (attempt < MAX_ATTEMPTS) {
        console.log(`${msg}, retrying...`);
        if (attempt === 1) {
          capture.message(msg, {
            extra: { error, retrying: true },
            level: "warning",
          });
        }
        await Util.sleep(50);
        return createOrganizationInternal(orgData, orgType, ++attempt);
      }
      console.log(`${msg}, NOT RETRYING!`);
      capture.message(msg + " - NOT RETRYING", {
        extra: { error, retrying: false },
        level: "error",
      });
    }
    throw error;
  }
}
