import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";

interface ToggleMCPRequest {
  pluginId: string;
  enabled: boolean;
}

interface UpdateMCPRequest {
  serverName: string;
  config: {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
}

interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
  [key: string]: unknown;
}

interface MCPFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Toggle MCP server enabled state
 * For plugin-based servers, this updates enabledPlugins in ~/.claude/settings.json
 */
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as ToggleMCPRequest;
    const { pluginId, enabled } = body;

    if (!pluginId) {
      return NextResponse.json(
        { error: "pluginId is required" },
        { status: 400 }
      );
    }

    const settingsPath = path.join(homedir(), ".claude", "settings.json");

    // Read current settings
    let settings: SettingsFile = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content) as SettingsFile;
    } catch {
      // File doesn't exist or is invalid, start with empty
    }

    // Ensure enabledPlugins exists
    if (!settings.enabledPlugins) {
      settings.enabledPlugins = {};
    }

    // Update the plugin state
    settings.enabledPlugins[pluginId] = enabled;

    // Write back
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");

    return NextResponse.json({ success: true, pluginId, enabled });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Update a user-defined MCP server configuration
 * Updates ~/.claude/.mcp.json
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateMCPRequest;
    const { serverName, config } = body;

    if (!serverName) {
      return NextResponse.json(
        { error: "serverName is required" },
        { status: 400 }
      );
    }

    const mcpPath = path.join(homedir(), ".claude", ".mcp.json");

    // Read current MCP config
    let mcpFile: MCPFile = {};
    try {
      const content = await fs.readFile(mcpPath, "utf-8");
      mcpFile = JSON.parse(content) as MCPFile;
    } catch {
      // File doesn't exist or is invalid, start with empty
    }

    // Handle both { mcpServers: {...} } and flat { serverName: {...} } formats
    if (mcpFile.mcpServers) {
      // Nested format
      mcpFile.mcpServers[serverName] = config;
    } else {
      // Flat format - update directly
      mcpFile[serverName] = config;
    }

    // Write back
    await fs.writeFile(mcpPath, JSON.stringify(mcpFile, null, 2), "utf-8");

    return NextResponse.json({ success: true, serverName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
