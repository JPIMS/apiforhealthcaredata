import * as dotenv from "dotenv";
dotenv.config();
// keep that ^ on top
import { MetriportMedicalApi, PatientCreate, USState } from "@metriport/api-sdk";
import { GenderAtBirth } from "@metriport/core/domain/patient";
import { getEnvVarOrFail } from "@metriport/core/util/env-var";
import { errorToString } from "@metriport/core/util/error/shared";
import { sleep } from "@metriport/core/util/sleep";
import { Command } from "commander";
import csv from "csv-parser";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import fs from "fs";
import path from "path";
import { buildGetDirPathInside, initRunsFolder } from "./shared/folder";
import { getCxData } from "./shared/get-cx-data";
import { logNotDryRun } from "./shared/log";

dayjs.extend(duration);

/**
 * This script will read patients from a .csv file and insert them into the Metriport API.
 *
 * Format of the .csv file:
 * - first line contains column names
 * - columns can be in any order
 * - minimum columns: firstname,lastname,dob,gender,zip,city,state,address1,address2,phone,email,externalId
 * - it may contain more columns, only those above will be used
 *
 * Either set the env vars below on the OS or create a .env file in the root folder of this package.
 *
 * Execute this with:
 * $ npm run bulk-insert -- --dryrun
 * $ npm run bulk-insert
 */

/**
 * Only need to provide the facilityId if the CX has more than one facility.
 * Used to determine the NPI used to query CW.
 */
const facilityId: string = ""; // eslint-disable-line @typescript-eslint/no-inferrable-types

const apiKey = getEnvVarOrFail("API_KEY");
const apiUrl = getEnvVarOrFail("API_URL");
const cxId = getEnvVarOrFail("CX_ID");
const delayTime = dayjs.duration(5, "seconds").asMilliseconds();
const inputFileName = "bulk-insert-patients.csv";
const ISO_DATE = "YYYY-MM-DD";
const confirmationTime = dayjs.duration(10, "seconds");

const getFileName = buildGetDirPathInside(`bulk-insert`);

type Params = {
  dryrun?: boolean;
};
const program = new Command();
program
  .name("bulk-insert-patients")
  .description("CLI to import patients from a .csv file into the Metriport API.")
  .option(`--dryrun`, "Just validate the CSV without importing the patients")
  .showHelpAfterError();

const metriportAPI = new MetriportMedicalApi(apiKey, {
  baseAddress: apiUrl,
});

async function main() {
  initRunsFolder();
  program.parse();
  const { dryrun: dryRunParam } = program.opts<Params>();
  const dryRun = dryRunParam ?? false;

  const { orgName, facilityId: localFacilityId } = await getCxData(cxId, facilityId.trim());
  if (!localFacilityId) throw new Error("No facility found");
  const outputFileName = getFileName(orgName) + ".txt";

  if (!dryRun) initPatientIdRepository(outputFileName);

  // This will insert all the patients into a specific facility.
  // Based off the apiKey it will determine the cx to add to the patients.
  const results: PatientCreate[] = [];
  fs.createReadStream(path.join(__dirname, inputFileName))
    .pipe(csv({ mapHeaders: ({ header }) => header.replaceAll(" ", "").replaceAll("*", "") }))
    .on("data", async data => {
      const metriportPatient = mapCSVPatientToMetriportPatient(data);
      if (metriportPatient) results.push(metriportPatient);
    })
    .on("end", async () => loadData(results, orgName, localFacilityId, outputFileName, dryRun));
}

async function loadData(
  results: PatientCreate[],
  orgName: string,
  localFacilityId: string,
  outputFileName: string,
  dryRun: boolean
) {
  const msg = `Loaded ${results.length} patients from the CSV file to be inserted at org/cx ${orgName}`;
  console.log(msg);
  if (dryRun) {
    console.log("Dry run, not inserting patients.");
    console.log(`List of patients: ${JSON.stringify(results, null, 2)}`);
    console.log(msg);
    console.log("Done.");
    return;
  }
  await displayWarningAndConfirmation(results, orgName, dryRun);
  let successfulCount = 0;
  const errors: Array<{ firstName: string; lastName: string; dob: string; message: string }> = [];

  for (const [i, patient] of results.entries()) {
    try {
      const createdPatient = await metriportAPI.createPatient(patient, localFacilityId, {
        rerunPdOnNewDemographics: true,
      });
      successfulCount++;
      console.log(i + 1, createdPatient);
      storePatientId(createdPatient.id, outputFileName);
      if (i < results.length - 1) await sleep(delayTime);
    } catch (error) {
      errors.push({
        firstName: patient.firstName,
        lastName: patient.lastName,
        dob: patient.dob,
        message: errorToString(error),
      });
    }
  }
  console.log(errors);
  console.log(`Done, inserted ${successfulCount} patients.`);
}

async function displayWarningAndConfirmation(results: unknown[], orgName: string, dryRun: boolean) {
  if (!dryRun) logNotDryRun();
  console.log(
    `Inserting ${
      results.length
    } patients at org/cx ${orgName} in ${confirmationTime.asSeconds()} seconds...`
  );
  await sleep(confirmationTime.asMilliseconds());
  console.log(`running...`);
}

function initPatientIdRepository(fileName: string) {
  const dirname = path.dirname(fileName);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
  fs.writeFileSync(fileName, "");
}

function storePatientId(patientId: string, fileName: string) {
  fs.appendFileSync(fileName, patientId + "\n");
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(" ")
    .map(s => s.charAt(0).toUpperCase() + s.substring(1))
    .join(" ")
    .trim();
}

function normalizeGender(gender: string | undefined): GenderAtBirth {
  if (gender == undefined) throw new Error(`Missing gender`);
  const lowerGender = gender.toLowerCase().trim();
  if (lowerGender === "male" || lowerGender === "m") {
    return "M";
  } else if (lowerGender === "female" || lowerGender === "f") {
    return "F";
  } else if (lowerGender === "other" || lowerGender === "un" || lowerGender === "o") {
    return "O";
  } else if (lowerGender === "unknown" || lowerGender === "unk" || lowerGender === "u") {
    return "U";
  }
  throw new Error(`Invalid gender ${gender}`);
}

function normalizeName(name: string | undefined, propName: string): string {
  if (name == undefined) throw new Error(`Missing ` + propName);
  return toTitleCase(name);
}

const phoneRegex = /^\+?1?\d{10}$/;

function normalizePhone(phone: string | undefined): string | undefined {
  if (phone == undefined) return undefined;
  const trimmedPhone = phone.trim().replaceAll("-", "");
  if (trimmedPhone.length === 0) return undefined;
  if (trimmedPhone.match(phoneRegex)) {
    // removes leading country code +1
    return trimmedPhone.slice(-10);
  }
  throw new Error(`Invalid phone ${phone}`);
}

function normalizeAddressLine(addressLine: string | undefined, propName: string): string {
  if (addressLine == undefined) throw new Error(`Missing ` + propName);
  return toTitleCase(addressLine);
}

function normalizeCity(city: string | undefined): string {
  if (city == undefined) throw new Error(`Missing city`);
  return toTitleCase(city);
}

function normalizeEmail(email: string | undefined): string | undefined {
  if (email == undefined) return undefined;
  const trimmedEmail = email.trim();
  if (trimmedEmail.length === 0) return undefined;
  return trimmedEmail.toLowerCase();
}

function normalizeExternalId(id: string | undefined): string | undefined {
  if (id == undefined) return undefined;
  const trimmedId = id.trim();
  if (trimmedId.length === 0) return undefined;
  return trimmedId;
}

function normalizeZip(zip: string | undefined): string {
  if (zip == undefined) throw new Error(`Missing zip`);
  return zip.trim();
}

function normalizeDate(date: string | undefined): string {
  if (date == undefined) throw new Error(`Missing dob`);
  const trimmedDate = date.trim();
  const parsedDate = dayjs(trimmedDate, ISO_DATE, true);
  if (!parsedDate.isValid()) {
    throw new Error(`Invalid date ${date}`);
  }
  return parsedDate.format(ISO_DATE);
}

function normalizeState(state: string | undefined): USState {
  if (state == undefined) throw new Error(`Missing state`);
  if (Object.values(states).includes(USState[state as keyof typeof USState])) {
    return USState[state as keyof typeof USState];
  } else if (states[state]) {
    return states[state];
  } else if (state === "DC") {
    return USState.DC;
  }
  throw new Error(`Invalid state ${state}`);
}

const mapCSVPatientToMetriportPatient = (csvPatient: {
  firstname: string | undefined;
  lastname: string | undefined;
  dob: string | undefined;
  gender: string | undefined;
  zip: string | undefined;
  city: string | undefined;
  state: string | undefined;
  address1: string | undefined;
  addressLine1: string | undefined;
  address2: string | undefined;
  addressLine2: string | undefined;
  phone: string | undefined;
  phone1: string | undefined;
  phone2: string | undefined;
  email: string | undefined;
  email1: string | undefined;
  email2: string | undefined;
  id: string | undefined;
  externalId: string | undefined;
}): PatientCreate | undefined => {
  const phone1 = normalizePhone(csvPatient.phone ?? csvPatient.phone1);
  const email1 = normalizeEmail(csvPatient.email ?? csvPatient.email1);
  const phone2 = normalizePhone(csvPatient.phone2);
  const email2 = normalizeEmail(csvPatient.email2);
  const contact1 = phone1 || email1 ? { phone: phone1, email: email1 } : undefined;
  const contact2 = phone2 || email2 ? { phone: phone2, email: email2 } : undefined;
  const contact = [contact1, contact2].flatMap(c => c ?? []);
  const externalId = csvPatient.id
    ? normalizeExternalId(csvPatient.id)
    : normalizeExternalId(csvPatient.externalId) ?? undefined;
  return {
    externalId,
    firstName: normalizeName(csvPatient.firstname, "firstname"),
    lastName: normalizeName(csvPatient.lastname, "lastname"),
    dob: normalizeDate(csvPatient.dob),
    genderAtBirth: normalizeGender(csvPatient.gender),
    address: {
      addressLine1: normalizeAddressLine(
        csvPatient.address1 ?? csvPatient.addressLine1,
        "address1 | addressLine1"
      ),
      addressLine2: normalizeAddressLine(
        csvPatient.address2 ?? csvPatient.addressLine2,
        "address2 | addressLine2"
      ),
      city: normalizeCity(csvPatient.city),
      state: normalizeState(csvPatient.state),
      zip: normalizeZip(csvPatient.zip),
      country: "USA",
    },
    contact,
  };
};

const states: { [k in string]: USState } = {
  Arizona: USState.AZ,
  Alabama: USState.AL,
  Alaska: USState.AK,
  Arkansas: USState.AR,
  California: USState.CA,
  Colorado: USState.CO,
  Connecticut: USState.CT,
  Delaware: USState.DE,
  Florida: USState.FL,
  Georgia: USState.GA,
  Hawaii: USState.HI,
  Idaho: USState.ID,
  Illinois: USState.IL,
  Indiana: USState.IN,
  Iowa: USState.IA,
  Kansas: USState.KS,
  Kentucky: USState.KY,
  Louisiana: USState.LA,
  Maine: USState.ME,
  Maryland: USState.MD,
  Massachusetts: USState.MA,
  Michigan: USState.MI,
  Minnesota: USState.MN,
  Mississippi: USState.MS,
  Missouri: USState.MO,
  Montana: USState.MT,
  Nebraska: USState.NE,
  Nevada: USState.NV,
  "New Hampshire": USState.NH,
  "New Jersey": USState.NJ,
  "New Mexico": USState.NM,
  "New York": USState.NY,
  "North Carolina": USState.NC,
  "North Dakota": USState.ND,
  Ohio: USState.OH,
  Oklahoma: USState.OK,
  Oregon: USState.OR,
  Pennsylvania: USState.PA,
  "Rhode Island": USState.RI,
  "South Carolina": USState.SC,
  "South Dakota": USState.SD,
  Tennessee: USState.TN,
  Texas: USState.TX,
  Utah: USState.UT,
  Vermont: USState.VT,
  Virginia: USState.VA,
  Washington: USState.WA,
  "West Virginia": USState.WV,
  Wisconsin: USState.WI,
  Wyoming: USState.WY,
};

main();
