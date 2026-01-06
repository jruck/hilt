import { NextRequest, NextResponse } from "next/server";
import {
  getUserConfig,
  setUserConfig,
  hasFirecrawlKey,
  getFirecrawlKey,
} from "@/lib/user-config";

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape";

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      sourceURL?: string;
      ogTitle?: string;
      ogDescription?: string;
    };
  };
  error?: string;
}

/**
 * GET /api/firecrawl
 * Check if Firecrawl is configured
 */
export async function GET() {
  const configured = hasFirecrawlKey();
  return NextResponse.json({ configured });
}

/**
 * POST /api/firecrawl
 * Either configure the API key or scrape a URL
 *
 * Body for configure: { action: "configure", apiKey: string }
 * Body for scrape: { action: "scrape", url: string } or { url: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle configure action
    if (body.action === "configure") {
      const { apiKey } = body;

      if (!apiKey || typeof apiKey !== "string") {
        return NextResponse.json(
          { error: "API key is required" },
          { status: 400 }
        );
      }

      // Validate the key by making a test request
      const testResult = await testApiKey(apiKey);
      if (!testResult.valid) {
        return NextResponse.json(
          { error: `Invalid API key: ${testResult.error}` },
          { status: 400 }
        );
      }

      // Store the key
      setUserConfig({ firecrawlApiKey: apiKey });

      return NextResponse.json({
        success: true,
        message: "Firecrawl API key configured successfully",
      });
    }

    // Handle scrape action (default)
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    const apiKey = getFirecrawlKey();
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Firecrawl not configured",
          setup: {
            message: "Firecrawl requires an API key. Get one at https://firecrawl.dev",
            endpoint: "POST /api/firecrawl",
            body: { action: "configure", apiKey: "your-api-key" },
          },
        },
        { status: 401 }
      );
    }

    // Scrape the URL
    const result = await scrapeUrl(url, apiKey);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Scrape failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url,
      title: result.data?.metadata?.title || result.data?.metadata?.ogTitle,
      description: result.data?.metadata?.description || result.data?.metadata?.ogDescription,
      content: result.data?.markdown || result.data?.html,
      metadata: result.data?.metadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Request failed: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * Test if an API key is valid by making a minimal request
 */
async function testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Use a simple, fast-loading URL for testing
    const response = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: "https://example.com",
        formats: ["markdown"],
      }),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "Invalid or unauthorized API key" };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        valid: false,
        error: errorData.error || `API returned status ${response.status}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Scrape a URL using Firecrawl
 */
async function scrapeUrl(
  url: string,
  apiKey: string
): Promise<FirecrawlScrapeResponse> {
  try {
    const response = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        // Enable caching for faster repeated requests
        // waitFor: 1000, // Wait 1s for dynamic content
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || `Firecrawl returned status ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      data: data.data || data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Scrape failed",
    };
  }
}
