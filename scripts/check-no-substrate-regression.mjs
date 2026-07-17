#!/usr/bin/env node
import { runSubstrateMeasurement } from "./measure-platform-substrate.mjs";

const result=await runSubstrateMeasurement();
if(result.stdout) process.stdout.write(result.stdout);
if(result.stderr) process.stderr.write(result.stderr);
process.exitCode=result.exitCode;
