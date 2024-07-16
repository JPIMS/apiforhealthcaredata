import { ConsolidatedQuery } from "@metriport/api-sdk";
import { faker } from "@faker-js/faker";
import dayjs from "dayjs";
import * as uuidv7_file from "@metriport/core/util/uuid-v7";
import { ISO_DATE } from "@metriport/shared/common/date";
import { DocumentQueryProgress } from "@metriport/core/domain/document-query";
import { makeProgress } from "../../../../domain/medical/__tests__/document-query";
import { StoreQueryParams } from "../query-init";
import { makePatientData } from "../../../../domain/medical/__tests__/patient";
import { makePatientModel } from "../../../../models/medical/__tests__/patient";
import { WebhookRequest } from "../../../../models/webhook-request";

export const requestId = uuidv7_file.uuidv4();
export const patient = { id: uuidv7_file.uuidv7(), cxId: uuidv7_file.uuidv7() };

export const dqParams: StoreQueryParams = {
  id: patient.id,
  cxId: patient.cxId,
  cmd: {
    documentQueryProgress: {
      requestId,
      startedAt: new Date(),
      download: makeProgress(),
    },
  },
};

export const cqParams: StoreQueryParams = {
  id: patient.id,
  cxId: patient.cxId,
  cmd: {
    consolidatedQueries: [
      {
        requestId,
        status: "processing",
        startedAt: new Date(),
      },
    ],
  },
};

export const documentQueryProgress: DocumentQueryProgress = {
  requestId,
  startedAt: new Date(),
  download: makeProgress(),
  convert: makeProgress(),
};

export function makeConsolidatedQueryProgress(
  params?: Partial<ConsolidatedQuery>
): ConsolidatedQuery {
  const dateTo = dayjs(faker.date.recent()).format(ISO_DATE);

  return {
    requestId: params?.requestId ?? requestId,
    status: params?.status ?? "processing",
    startedAt: params?.startedAt ?? new Date(),
    resources: params?.resources ?? [],
    conversionType: params?.conversionType ?? "json",
    dateFrom: dayjs(
      faker.date.past({
        refDate: dateTo,
      })
    ).format(ISO_DATE),
    dateTo,
  };
}

export const mockedPatientAllProgresses = makePatientModel({
  data: makePatientData({
    documentQueryProgress,
    consolidatedQueries: [makeConsolidatedQueryProgress()],
  }),
});

export function makeConsolidatedWebhook(params?: Partial<WebhookRequest>): WebhookRequest {
  return {
    cxId: params?.cxId ?? patient.cxId,
    requestId: params?.requestId ?? requestId,
    type: "medical.consolidated-data",
    // url: faker.internet.url(),
  };
}
