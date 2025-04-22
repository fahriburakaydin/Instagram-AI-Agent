// src/app.ts

import express, { Application } from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';

import { runInstagram } from './client/Instagram';
import logger, { setupErrorHandlers } from './config/logger';
import { setup_HandleError } from './utils';
import { connectDB } from './config/db';

setupErrorHandlers();
dotenv.config();

export const app: Application = express();
connectDB();

app.use(helmet({ xssFilter: true, noSniff: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '1kb' }));
app.use(cookieParser());

async function oneCycle() {
  try {
    logger.info("🔄 Feed pass…");
    await runInstagram();

    logger.info("🔄 Comment‐reply pass…");
    await runInstagram(); // or runCommentReplies()

    logger.info("🔄 DM‐reply pass…");
    await runInstagram(); // or runDMReplies()
  } catch (err) {
    setup_HandleError(err, "oneCycle");
  }
}

export async function runAgents() {
  while (true) {
    await oneCycle();
    logger.info("⏱️ Sleeping 30 seconds before next cycle…");
    await new Promise(r => setTimeout(r, 30000));
  }
}
