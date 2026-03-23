import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { TreeforkError } from "./errors";
import type { TreeforkConfig } from "./types";

const LOCAL_CONFIG_NAME = "treefork.config.json";
const GLOBAL_CONFIG_PATH = join(".config", "treefork", "config.json");
const CONFIG_KEYS = [
  "repo",
  "storageDir",
  "defaultBaseRef",
  "branchPrefix",
  "checkpointRefPrefix",
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];
type LoadedConfig = Pick<TreeforkConfig, ConfigKey>;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function findLocalConfig(startDir: string): Promise<string | null> {
  let currentDir = resolve(startDir);

  while (true) {
    const candidatePath = join(currentDir, LOCAL_CONFIG_NAME);

    if (await pathExists(candidatePath)) {
      return candidatePath;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function parseConfigFile(contents: string, filePath: string): LoadedConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new TreeforkError(`Config file "${filePath}" contains invalid JSON.`, {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new TreeforkError(`Config file "${filePath}" must contain a JSON object.`);
  }

  const config: LoadedConfig = {};

  for (const key of CONFIG_KEYS) {
    const value = parsed[key];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string") {
      throw new TreeforkError(`Config value "${key}" in "${filePath}" must be a string.`);
    }

    config[key] = value;
  }

  return config;
}

async function readConfigFile(filePath: string): Promise<LoadedConfig> {
  const contents = await readFile(filePath, "utf8");
  return parseConfigFile(contents, filePath);
}

export async function loadConfig(cwd: string): Promise<LoadedConfig> {
  const localConfigPath = await findLocalConfig(cwd);

  if (localConfigPath !== null) {
    return readConfigFile(localConfigPath);
  }

  const globalConfigPath = join(homedir(), GLOBAL_CONFIG_PATH);

  if (await pathExists(globalConfigPath)) {
    return readConfigFile(globalConfigPath);
  }

  return {};
}
