import { Contact } from "@metriport/commonwell-sdk";
import { Patient } from "@metriport/core/domain/patient";
import { MedicalDataSource } from "@metriport/core/external/index";
import { getHieInitiator, HieInitiator, isHieEnabledToQuery } from "../hie/get-hie-initiator";

export async function getCwInitiator(
  patient: Pick<Patient, "id" | "cxId">,
  facilityId?: string
): Promise<HieInitiator> {
  return getHieInitiator(patient, facilityId);
}

export async function isFacilityEnabledToQueryCW(
  facilityId: string | undefined,
  patient: Pick<Patient, "id" | "cxId">
): Promise<boolean> {
  return await isHieEnabledToQuery(facilityId, patient, MedicalDataSource.COMMONWELL);
}

export function buildCwOrgName({
  vendorName,
  orgName,
  isProvider,
  oboOid,
}: {
  vendorName: string;
  orgName: string;
  isProvider: boolean;
  oboOid?: string | null;
}): string {
  if (oboOid && !isProvider) {
    return `${vendorName} - ${orgName} -OBO- ${oboOid}`;
  }
  return `${vendorName} - ${orgName}`;
}

export function getCwPatientContactType(
  telecom: Contact[] | null | undefined,
  system: "phone" | "email"
): string[] {
  if (telecom && telecom.length > 0) {
    const contacts: string[] = [];

    for (const contact of telecom) {
      if (contact.system === system && contact.value) {
        contacts.push(contact.value);
      }
    }

    return contacts;
  }

  return [];
}
