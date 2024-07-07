import * as dotenv from "dotenv";
dotenv.config();
// Keep dotenv import and config before everything else
import { processInboundDq } from "@metriport/core/external/carequality/dq/process-inbound-dq";
import { processInboundDr } from "@metriport/core/external/carequality/dr/process-inbound-dr";
import { processInboundXcpd } from "@metriport/core/external/carequality/pd/process-inbound-pd";
import { MPIMetriportAPI } from "@metriport/core/mpi/patient-mpi-metriport-api";
import { getEnvVarOrFail } from "@metriport/core/util/env-var";

import express, { Application, Request, Response } from "express";

const apiUrl = getEnvVarOrFail("API_URL");
const mpi = new MPIMetriportAPI(apiUrl);

const app: Application = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

app.post("/pd/v1", async (req: Request, res: Response) => {
  try {
    const response = await processInboundXcpd(req.body, mpi);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.send({ response });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    res.status(400).send(err.message);
  }
});

app.post("/dq/v1", async (req: Request, res: Response) => {
  try {
    const response = await processInboundDq(req.body, apiUrl);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.send({ response });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    res.status(400).send(err.message);
  }
});

app.post("/dr/v1", async (req: Request, res: Response) => {
  try {
    const response = await processInboundDr(req.body);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.send({ response });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    res.status(400).send(err.message);
  }
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
