import { Address } from "@metriport/core/domain/address";
import { Contact } from "@metriport/core/domain/contact";
import {
  normalizeEmail,
  normalizePhoneNumber,
  normalizeUSStateForAddress,
  normalizeZipCodeNew,
} from "@metriport/shared";
import { PatientResource } from "@metriport/shared/interface/external/athenahealth/patient";

export function createMetriportContacts(patient: PatientResource): Contact[] {
  return (patient.telecom ?? []).flatMap(telecom => {
    if (telecom.system === "email") {
      return {
        email: normalizeEmail(telecom.value),
      };
    } else if (telecom.system === "phone") {
      return {
        phone: normalizePhoneNumber(telecom.value),
      };
    }
    return [];
  });
}

export function createMetriportAddresses(patient: PatientResource): Address[] {
  return patient.address.map(address => {
    if (address.line.length === 0) {
      throw new Error("AthenaHealth patient missing at least one line in address");
    }
    return {
      addressLine1: address.line[0] as string,
      addressLine2: address.line.length > 1 ? address.line.slice(1).join(" ") : undefined,
      city: address.city,
      state: normalizeUSStateForAddress(address.state),
      zip: normalizeZipCodeNew(address.postalCode),
      country: address.country,
    };
  });
}

export function createNames(patient: PatientResource): { firstName: string; lastName: string }[] {
  const names: { firstName: string; lastName: string }[] = [];
  patient.name.map(name => {
    const lastName = name.family.trim();
    if (lastName === "") return;
    name.given.map(gName => {
      const firstName = gName.trim();
      if (firstName === "") return;
      names.push({ firstName, lastName });
    });
  });
  return names;
}
