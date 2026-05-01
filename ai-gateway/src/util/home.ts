import os from "node:os";
import path from "node:path";

export type GatewayPaths = {
  homeDir: string;
  configPath: string;
  credentialsPath: string;
  locksDir: string;
  logsDir: string;
};

export function resolveGatewayPaths(env: NodeJS.ProcessEnv = process.env): GatewayPaths {
  const homeDir = env.AI_GATEWAY_HOME?.trim()
    ? path.resolve(env.AI_GATEWAY_HOME)
    : path.join(os.homedir(), ".ai-gateway");
  return {
    homeDir,
    configPath: path.join(homeDir, "config.json"),
    credentialsPath: path.join(homeDir, "credentials.json"),
    locksDir: path.join(homeDir, "locks"),
    logsDir: path.join(homeDir, "logs"),
  };
}
