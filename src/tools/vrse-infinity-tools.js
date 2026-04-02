// VRse Builder Infinity Workshop MCP Tools
// Tools for searching, downloading, and placing assets from Infinity Workshop (Upload Master server)
import * as bridge from "../unity-editor-bridge.js";

// Normalizes bridge response: supports both result.result and result.data.result shapes
function parseUnityBridgeResult(result) {
  if (!result) return null;
  return result.data?.result || result.result || null;
}

export const vrseInfinityTools = [
  // ─── Tool 1: Get authentication and initialization status ─────────────
  {
    name: "vrse_infinity_status",
    description:
      "Returns the current Infinity Workshop authentication and initialization status. " +
      "Includes: isAuthenticated, username, userRole, isInitialized, current tenant, and available tenants. " +
      "Use this to check if the user needs to login via Window > Infinity Workshop before calling other tools.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: async () => {
      try {
        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("GetStatus", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, null);
        `);

        const parsedResult = parseUnityBridgeResult(result);
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to get status", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to get Infinity Workshop status: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 2: List/search remote assets ─────────────────────────────────
  {
    name: "vrse_infinity_list_assets",
    description:
      "Lists and searches for assets from the Infinity Workshop remote server. " +
      "Supports backend search by query string, tags (comma-separated), tenant name, pagination, and filters. " +
      "Returns array of assets with assetId, name, tags, thumbnailUrl, isCollection, collectionKey, and updatedAt. " +
      "Requires authentication - call vrse_infinity_status first to check auth status.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional search query to filter assets by name or description (backend search).",
        },
        tags: {
          type: "string",
          description: "Optional comma-separated tags to filter assets (e.g., 'furniture,medieval').",
        },
        tenantName: {
          type: "string",
          description: "Optional tenant name to search in (defaults to current tenant).",
        },
        page: {
          type: "number",
          description: "Page number for pagination (default: 1).",
        },
        limit: {
          type: "number",
          description: "Number of results per page (default: 100, max: 500).",
        },
        collectionsOnly: {
          type: "boolean",
          description: "If true, only return assets that are part of collections (default: false).",
        },
        showWip: {
          type: "boolean",
          description: "If true, include work-in-progress assets tagged with 'WIP' (default: false).",
        },
      },
      required: [],
    },
    handler: async ({ query, tags, tenantName, page, limit, collectionsOnly, showWip }) => {
      try {
        const safeQuery = query ? query.replace(/"/g, '\\"') : "";
        const safeTags = tags ? tags.replace(/"/g, '\\"') : "";
        const safeTenant = tenantName ? tenantName.replace(/"/g, '\\"') : "";

        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("ListAssets", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${safeQuery}", 
            "${safeTags}", 
            "${safeTenant}", 
            ${page || 1}, 
            ${limit || 100}, 
            ${collectionsOnly || false}, 
            ${showWip || false} 
          });
        `);

        const parsedResult = parseUnityBridgeResult(result);
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to list assets", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to list Infinity Workshop assets: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 3: Download assets by ID (async job-based) ──────────────────
  {
    name: "vrse_infinity_download_assets",
    description:
      "Starts downloading one or more assets from Infinity Workshop by asset ID. " +
      "Returns immediately with a jobId. Use vrse_infinity_poll_download to check progress and get results. " +
      "Assets are downloaded to the specified path (default: Assets/CommonArt/3DAssets). " +
      "Requires authentication - call vrse_infinity_status first to check auth status.",
    inputSchema: {
      type: "object",
      properties: {
        assetIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of asset IDs to download (from vrse_infinity_list_assets results).",
        },
        downloadPath: {
          type: "string",
          description: "Optional Unity project path to download assets to (default: 'Assets/CommonArt/3DAssets').",
        },
        conflictPolicy: {
          type: "string",
          enum: ["cancel", "overwrite", "skip"],
          description: "How to handle existing assets: 'cancel' stops on conflict, 'overwrite' replaces, 'skip' continues (default: 'cancel').",
        },
      },
      required: ["assetIds"],
    },
    handler: async ({ assetIds, downloadPath, conflictPolicy }) => {
      try {
        const assetIdsJson = JSON.stringify(assetIds);
        const safeAssetIdsJson = assetIdsJson.replace(/"/g, '\\"');
        const safePath = downloadPath ? downloadPath.replace(/"/g, '\\"') : "";
        const safePolicy = conflictPolicy || "cancel";

        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("DownloadAssets", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${safeAssetIdsJson}", 
            "${safePath}", 
            "${safePolicy}" 
          });
        `);

        const startResponse = parseUnityBridgeResult(result);
        if (startResponse) {
          if (startResponse.startsWith("STARTED:")) {
            const parts = startResponse.split(":");
            const jobId = parts[1];

            let attempts = 0;
            const maxAttempts = 180;

            while (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              const pollResult = await bridge.executeCode(`
                var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
                var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
                var method = helperType.GetMethod("PollDownloadJob", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                return (string)method.Invoke(null, new object[] { "${jobId}" });
              `);

              const pollResponse = parseUnityBridgeResult(pollResult);
              if (pollResponse) {
                const status = JSON.parse(pollResponse);
                
                if (status.status === "complete") {
                  return JSON.stringify({
                    success: true,
                    results: status.results,
                    successCount: status.success,
                    failCount: status.failed,
                    message: `Downloaded ${status.success}/${status.total} assets successfully.`
                  }, null, 2);
                } else if (status.status === "error") {
                  return JSON.stringify({
                    error: true,
                    message: `Download failed: ${status.error}`,
                    results: status.results
                  }, null, 2);
                }
              }
              
              attempts++;
            }

            return JSON.stringify({ error: true, message: "Download timed out after 6 minutes" }, null, 2);
          } else {
            try {
              return startResponse;
            } catch {
              return JSON.stringify({ error: true, message: "Unexpected response format", details: startResponse }, null, 2);
            }
          }
        }
        return JSON.stringify({ error: true, message: "Failed to start download", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to download Infinity Workshop assets: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 3b: Poll download job status ─────────────────────────────────
  {
    name: "vrse_infinity_poll_download",
    description:
      "Checks the status of a download job started by vrse_infinity_download_assets. " +
      "Returns current progress and results when complete.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job ID returned from vrse_infinity_download_assets.",
        },
      },
      required: ["jobId"],
    },
    handler: async ({ jobId }) => {
      try {
        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("PollDownloadJob", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { "${jobId}" });
        `);

        const parsedResult = parseUnityBridgeResult(result);
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to poll download job", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to poll download: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 4: Find local paths for downloaded assets ───────────────────
  {
    name: "vrse_infinity_find_local_model_paths",
    description:
      "Finds local Unity paths for downloaded Infinity Workshop assets by searching for _assetId.txt files. " +
      "Returns folder path, FBX path, and prefab path for each asset ID. " +
      "Use this after downloading to discover the exact paths for scene placement or inspection. " +
      "Does not require authentication (local filesystem operation).",
    inputSchema: {
      type: "object",
      properties: {
        assetIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of asset IDs to locate locally.",
        },
      },
      required: ["assetIds"],
    },
    handler: async ({ assetIds }) => {
      try {
        const assetIdsJson = JSON.stringify(assetIds);
        const safeAssetIdsJson = assetIdsJson.replace(/"/g, '\\"');

        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("FindLocalModelPaths", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { "${safeAssetIdsJson}" });
        `);

        const parsedResult = parseUnityBridgeResult(result);
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to find local paths", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to find local model paths: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 5: Add asset to scene ────────────────────────────────────────
  {
    name: "vrse_infinity_add_to_scene",
    description:
      "Instantiates a downloaded Infinity Workshop asset into the current Unity scene. " +
      "Accepts Unity asset path (FBX or prefab) and optional transform parameters. " +
      "Returns GameObject path and instance ID. " +
      "Use vrse_infinity_find_local_model_paths first to get the assetPath. " +
      "Does not require authentication (uses local asset).",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: {
          type: "string",
          description: "Unity asset path to instantiate (e.g., 'Assets/CommonArt/3DAssets/CastleWall/CastleWall.prefab').",
        },
        name: {
          type: "string",
          description: "Optional name for the instantiated GameObject (defaults to asset name).",
        },
        position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Position in world space (default: {x:0, y:0, z:0}).",
        },
        rotation: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Rotation in Euler angles (default: {x:0, y:0, z:0}).",
        },
        scale: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Local scale (default: {x:1, y:1, z:1}).",
        },
        parent: {
          type: "string",
          description: "Optional parent GameObject name to place this under in hierarchy.",
        },
      },
      required: ["assetPath"],
    },
    handler: async ({ assetPath, name, position, rotation, scale, parent }) => {
      try {
        const safePath = assetPath.replace(/"/g, '\\"');
        const safeName = name ? name.replace(/"/g, '\\"') : "";
        const safeParent = parent ? parent.replace(/"/g, '\\"') : "";

        const pos = position || { x: 0, y: 0, z: 0 };
        const rot = rotation || { x: 0, y: 0, z: 0 };
        const scl = scale || { x: 1, y: 1, z: 1 };

        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("AddToScene", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${safePath}", 
            "${safeName}", 
            ${pos.x}f, ${pos.y}f, ${pos.z}f,
            ${rot.x}f, ${rot.y}f, ${rot.z}f,
            ${scl.x}f, ${scl.y}f, ${scl.z}f,
            "${safeParent}" 
          });
        `);

        const parsedResult = parseUnityBridgeResult(result);
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to add to scene", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to add asset to scene: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 6: Combined search + download workflow ───────────────────────
  {
    name: "vrse_infinity_download_by_query",
    description:
      "One-shot tool that searches for assets matching a query, then downloads the top matching results. " +
      "Useful for natural language requests like 'download a medieval castle wall'. " +
      "Returns both the candidate list (what was found) and download results (what was downloaded). " +
      "Requires authentication - call vrse_infinity_status first to check auth status.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for the asset (e.g., 'castle wall', 'medieval table').",
        },
        tags: {
          type: "string",
          description: "Optional comma-separated tags to filter results (e.g., 'furniture,medieval').",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of search results to consider (default: 20).",
        },
        topK: {
          type: "number",
          description: "Number of top matches to download (default: 1).",
        },
        downloadPath: {
          type: "string",
          description: "Optional Unity project path to download assets to (default: 'Assets/CommonArt/3DAssets').",
        },
        conflictPolicy: {
          type: "string",
          enum: ["cancel", "overwrite", "skip"],
          description: "How to handle existing assets (default: 'cancel').",
        },
      },
      required: ["query"],
    },
    handler: async ({ query, tags, maxResults, topK, downloadPath, conflictPolicy }) => {
      try {
        const safeQuery = query ? query.replace(/"/g, '\\"') : "";
        const safeTags = tags ? tags.replace(/"/g, '\\"') : "";
        const safePath = downloadPath ? downloadPath.replace(/"/g, '\\"') : "";
        const safePolicy = conflictPolicy || "cancel";
        const safeMaxResults = maxResults || 20;
        const safeTopK = topK || 1;

        const listResult = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("ListAssets", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${safeQuery}", 
            "${safeTags}", 
            null, 
            1, 
            ${safeMaxResults}, 
            false, 
            false 
          });
        `);

        if (!listResult || !listResult.success || !listResult.result) {
          return JSON.stringify({ error: true, message: "Failed to search assets", details: listResult }, null, 2);
        }

        const listData = JSON.parse(listResult.result);
        
        if (listData.error) {
          return listResult.result;
        }

        if (!listData.assets || listData.assets.length === 0) {
          return JSON.stringify({ 
            success: true, 
            candidates: [], 
            downloaded: [], 
            message: "No assets found matching query." 
          }, null, 2);
        }

        const topAssets = listData.assets.slice(0, safeTopK);
        const assetIdsToDownload = topAssets.map(a => a.assetId);
        const assetIdsJson = JSON.stringify(assetIdsToDownload).replace(/"/g, '\\"');

        const downloadResult = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("DownloadAssets", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${assetIdsJson}", 
            "${safePath}", 
            "${safePolicy}" 
          });
        `);

        if (!downloadResult || !downloadResult.success || !downloadResult.result) {
          return JSON.stringify({ 
            error: true, 
            message: "Search succeeded but download failed", 
            candidates: topAssets,
            details: downloadResult 
          }, null, 2);
        }

        const downloadData = JSON.parse(downloadResult.result);

        return JSON.stringify({
          success: true,
          query: query,
          candidates: listData.assets.slice(0, 10).map((a, i) => ({ 
            assetId: a.assetId, 
            name: a.name, 
            rank: i + 1 
          })),
          downloaded: downloadData.results || [],
          downloadedCount: downloadData.successCount || 0,
          message: `Found ${listData.assets.length} assets, downloaded top ${safeTopK}.`
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ 
          error: true, 
          message: `Failed to download by query: ${error.message}` 
        }, null, 2);
      }
    },
  },

  // ─── Tool 7: Initialize Infinity Workshop Manager ─────────────────────
  {
    name: "vrse_infinity_initialize",
    description:
      "Initializes the Infinity Workshop Manager asynchronously. " +
      "Returns immediately with a jobId. Use vrse_infinity_poll_initialize to check completion. " +
      "Call this if vrse_infinity_status shows NOT_INITIALIZED. " +
      "Initialization includes authenticating with the server and fetching tenant information.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: async () => {
      try {
        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("Initialize", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, null);
        `);

        const response = parseUnityBridgeResult(result);
        if (response) {
          if (response.startsWith("STARTED:")) {
            const jobId = response.split(":")[1];
            
            let attempts = 0;
            const maxAttempts = 30;

            while (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              const pollResult = await bridge.executeCode(`
                var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
                var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
                var method = helperType.GetMethod("PollInitializeJob", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                return (string)method.Invoke(null, new object[] { "${jobId}" });
              `);

              if (pollResult && pollResult.success && pollResult.result) {
                const status = JSON.parse(pollResult.result);
                
                if (status.status === "complete") {
                  return JSON.stringify({
                    success: true,
                    isAuthenticated: status.isAuthenticated,
                    username: status.username,
                    tenantName: status.tenantName,
                    message: "Infinity Workshop initialized successfully."
                  }, null, 2);
                } else if (status.status === "error") {
                  return JSON.stringify({
                    error: true,
                    message: `Initialization failed: ${status.error}`
                  }, null, 2);
                }
              }
              
              attempts++;
            }

            return JSON.stringify({ error: true, message: "Initialization timed out after 60 seconds" }, null, 2);
          } else {
            try {
              return response;
            } catch {
              return JSON.stringify({ error: true, message: "Unexpected response format", details: response }, null, 2);
            }
          }
        }
        return JSON.stringify({ error: true, message: "Failed to initialize", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to initialize Infinity Workshop: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 8: Poll initialization job status ────────────────────────────
  {
    name: "vrse_infinity_poll_initialize",
    description:
      "Checks the status of an initialization job started by vrse_infinity_initialize. " +
      "Returns current status and authentication info when complete.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job ID returned from vrse_infinity_initialize.",
        },
      },
      required: ["jobId"],
    },
    handler: async ({ jobId }) => {
      try {
        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("PollInitializeJob", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { "${jobId}" });
        `);

        const parsedResult = parseUnityBridgeResult(result);
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to poll initialization job", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to poll initialization: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 9: Smart asset placement ─────────────────────────────────────
  {
    name: "vrse_infinity_place_smart",
    description:
      "Intelligently places a downloaded Infinity Workshop asset into the scene with collision-safe placement. " +
      "strictSafePlacement mode prevents overlaps and clutter by using quality scoring, adaptive retries, and footprint limits. " +
      "If strictSafePlacement=true (default for batch operations), placement may be rejected if no quality spot exists (returns error with rejectionReason). " +
      "Optionally snaps to ground via raycasting. " +
      "IMPORTANT: If placement looks wrong, provide centerPosition to specify where you want objects placed. " +
      "Use vrse_infinity_find_local_model_paths first to get the assetPath. " +
      "Does not require authentication (uses local asset).",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: {
          type: "string",
          description: "Unity asset path to instantiate (e.g., 'Assets/CommonArt/3DAssets/CastleWall/CastleWall.prefab').",
        },
        name: {
          type: "string",
          description: "Optional name for the instantiated GameObject (defaults to asset name if not provided).",
        },
        centerPosition: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Optional center point for placement search (if not provided, analyzes scene to find cluster center).",
        },
        targetArea: {
          type: "string",
          description: "Optional parent GameObject name to constrain search area.",
        },
        spacing: {
          type: "number",
          description: "Minimum distance from other objects in meters (default: 0.5).",
        },
        snapToGround: {
          type: "boolean",
          description: "If true, raycasts downward to find ground level (default: false).",
        },
        scale: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Local scale (default: {x:1, y:1, z:1}).",
        },
        strictSafePlacement: {
          type: "boolean",
          description: "Enable collision-safe placement with quality validation (default: false for single asset). Rejects placement if no quality spot exists.",
        },
        qualityPreset: {
          type: "string",
          enum: ["strict", "balanced", "relaxed"],
          description: "Quality rules preset: 'strict' (large spacing, low density), 'balanced' (default), 'relaxed' (tight spacing allowed).",
        },
      },
      required: ["assetPath"],
    },
    handler: async ({ assetPath, name, centerPosition, targetArea, spacing, snapToGround, scale, strictSafePlacement, qualityPreset }) => {
      try {
        const safePath = assetPath.replace(/"/g, '\\"');
        const safeName = name ? name.replace(/"/g, '\\"') : "";
        const safeTargetArea = targetArea ? targetArea.replace(/"/g, '\\"') : "";
        const safeSpacing = spacing !== undefined ? spacing : 0.5;
        const safeSnap = snapToGround !== undefined ? snapToGround : false;
        const scl = scale || { x: 1, y: 1, z: 1 };
        const centerX = centerPosition?.x !== undefined ? centerPosition.x : "float.NaN";
        const centerY = centerPosition?.y !== undefined ? centerPosition.y : "float.NaN";
        const centerZ = centerPosition?.z !== undefined ? centerPosition.z : "float.NaN";
        const safeStrict = strictSafePlacement !== undefined ? strictSafePlacement : false;
        const safePreset = qualityPreset ? qualityPreset.replace(/"/g, '\\"') : "balanced";

        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("PlaceSmart", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${safePath}", 
            "${safeName}", 
            "${safeTargetArea}", 
            ${safeSpacing}f, 
            ${safeSnap}, 
            ${scl.x}f, ${scl.y}f, ${scl.z}f,
            ${centerX}f, ${centerY}f, ${centerZ}f,
            ${safeStrict},
            "${safePreset}"
          });
        `);

        const parsedResult = result?.data?.result || result?.result;
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to place smart", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to smart place asset: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 10: Batch smart asset placement ───────────────────────────────
  {
    name: "vrse_infinity_place_smart_batch",
    description:
      "Places multiple downloaded Infinity Workshop assets intelligently in one operation with collision-safe placement. " +
      "strictSafePlacement now DEFAULTS TO TRUE for batch operations to prevent clutter. " +
      "Uses quality scoring, adaptive retries, and footprint limits to ensure non-overlapping, well-spaced placement. " +
      "Returns detailed diagnostics: placed count, skipped count, rejection reasons, and quality metrics. " +
      "Fetches scene bounds ONCE, then for each asset finds an empty spot that avoids all previously placed objects in THIS batch. " +
      "Does not require authentication (uses local assets).",
    inputSchema: {
      type: "object",
      properties: {
        assetPaths: {
          type: "array",
          items: { type: "string" },
          description: "Array of Unity asset paths to place (e.g., ['Assets/CommonArt/3DAssets/Car1/Car1.fbx', 'Assets/CommonArt/3DAssets/Car2/Car2.fbx']).",
        },
        centerPosition: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Optional center point for placement search. Highly recommended for predictable placement.",
        },
        targetArea: {
          type: "string",
          description: "Optional parent GameObject name to constrain search area.",
        },
        spacing: {
          type: "number",
          description: "Minimum distance between objects in meters (default: 3.0).",
        },
        snapToGround: {
          type: "boolean",
          description: "If true, raycasts to find ground level (default: false).",
        },
        scale: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Scale for all assets (default: {x:1, y:1, z:1}).",
        },
        strictSafePlacement: {
          type: "boolean",
          description: "Enable collision-safe placement with quality validation (default: TRUE for batch). Set false to use legacy spiral-only behavior.",
        },
        qualityPreset: {
          type: "string",
          enum: ["strict", "balanced", "relaxed"],
          description: "Quality rules preset: 'strict' (large spacing, low density), 'balanced' (default), 'relaxed' (tight spacing allowed).",
        },
      },
      required: ["assetPaths"],
    },
    handler: async ({ assetPaths, centerPosition, targetArea, spacing, snapToGround, scale, strictSafePlacement, qualityPreset }) => {
      try {
        const assetPathsJsonEscaped = JSON.stringify(assetPaths).replace(/"/g, '\\"');
        const safeTargetArea = targetArea ? targetArea.replace(/"/g, '\\"') : "";
        const safeSpacing = spacing !== undefined ? spacing : 3.0;
        const safeSnap = snapToGround !== undefined ? snapToGround : false;
        const scl = scale || { x: 1, y: 1, z: 1 };
        const centerX = centerPosition?.x !== undefined ? centerPosition.x : "float.NaN";
        const centerY = centerPosition?.y !== undefined ? centerPosition.y : "float.NaN";
        const centerZ = centerPosition?.z !== undefined ? centerPosition.z : "float.NaN";
        const safeStrict = strictSafePlacement !== undefined ? strictSafePlacement : true;
        const safePreset = qualityPreset ? qualityPreset.replace(/"/g, '\\"') : "balanced";

        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("PlaceSmartBatch", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${assetPathsJsonEscaped}", 
            "${safeTargetArea}", 
            ${safeSpacing}f, 
            ${safeSnap}, 
            ${scl.x}f, ${scl.y}f, ${scl.z}f,
            ${centerX}f, ${centerY}f, ${centerZ}f,
            ${safeStrict},
            "${safePreset}"
          });
        `);

        const parsedResult = result?.data?.result || result?.result;
        if (parsedResult) {
          return parsedResult;
        }
        return JSON.stringify({ error: true, message: "Failed to batch place", details: result }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to batch place assets: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 11: Complete download and place workflow ──────────────────────
  {
    name: "vrse_infinity_download_and_place",
    description:
      "Complete workflow: downloads assets by query, waits for completion, finds paths, and places them smartly in the scene. " +
      "Uses collision-safe placement by default (strictSafePlacement=true) to prevent overlaps and clutter. " +
      "This is the recommended tool for simple 'download and add X to scene' requests. " +
      "Handles initialization automatically. " +
      "Returns final placement results with detailed diagnostics (placed count, skipped count, rejection reasons).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'car', 'truck', 'table').",
        },
        tags: {
          type: "string",
          description: "Optional comma-separated tags to filter by (e.g., 'Vehicle,Complete').",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of assets to download and place (default: 3).",
        },
        centerPosition: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          description: "Where to place the assets (highly recommended for predictable results).",
        },
        spacing: {
          type: "number",
          description: "Minimum distance between placed objects in meters (default: 3.0).",
        },
        snapToGround: {
          type: "boolean",
          description: "If true, snaps assets to ground via raycasting (default: true).",
        },
        strictSafePlacement: {
          type: "boolean",
          description: "Enable collision-safe placement with quality validation (default: TRUE). Set false to use legacy behavior.",
        },
        qualityPreset: {
          type: "string",
          enum: ["strict", "balanced", "relaxed"],
          description: "Quality rules preset: 'strict' (large spacing, low density), 'balanced' (default), 'relaxed' (tight spacing allowed).",
        },
      },
      required: ["query"],
    },
    handler: async ({ query, tags, maxResults, centerPosition, spacing, snapToGround, strictSafePlacement, qualityPreset }) => {
      try {
        const maxRes = maxResults || 3;
        const safeSpacing = spacing !== undefined ? spacing : 3.0;
        const safeSnap = snapToGround !== undefined ? snapToGround : true;
        const safeStrict = strictSafePlacement !== undefined ? strictSafePlacement : true;
        const safePreset = qualityPreset ? qualityPreset.replace(/"/g, '\\"') : "balanced";

        // Step 1: Check initialization
        const statusResult = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("GetStatus", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, null);
        `);

        const statusResponse = parseUnityBridgeResult(statusResult);
        const status = JSON.parse(statusResponse);
        
        // Step 2: Initialize if needed
        if (!status.isInitialized || !status.isAuthenticated) {
          const initResult = await bridge.executeCode(`
            var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
            var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
            var method = helperType.GetMethod("Initialize", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            return (string)method.Invoke(null, null);
          `);

          const initResponse = parseUnityBridgeResult(initResult);
          if (initResponse && initResponse.startsWith("STARTED:")) {
            const jobId = initResponse.split(":")[1];
            
            // Poll for completion
            for (let i = 0; i < 20; i++) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              const pollResult = await bridge.executeCode(`
                var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
                var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
                var method = helperType.GetMethod("PollInitializeJob", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                return (string)method.Invoke(null, new object[] { "${jobId}" });
              `);

              const pollInitResponse = parseUnityBridgeResult(pollResult);
              const pollData = JSON.parse(pollInitResponse);
              if (pollData.status === "complete") {
                if (!pollData.isAuthenticated) {
                  return JSON.stringify({ 
                    error: true, 
                    message: "Not authenticated. Please login in Unity: Window > Infinity Workshop" 
                  }, null, 2);
                }
                break;
              } else if (pollData.status === "error") {
                return JSON.stringify({ error: true, message: pollData.error }, null, 2);
              }
            }
          }
        }

        // Step 3: List assets to download
        const listResult = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("ListAssets", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${query.replace(/"/g, '\\"')}", 
            "${tags?.replace(/"/g, '\\"') || ''}", 
            null, 
            1, 
            ${maxRes}, 
            false, 
            false 
          });
        `);

        const listData = JSON.parse(listResult.result);
        if (listData.error || !listData.assets || listData.assets.length === 0) {
          return JSON.stringify({ 
            error: true, 
            message: `No assets found for query: ${query}`,
            details: listData 
          }, null, 2);
        }

        const assetIds = listData.assets.map(a => a.assetId);

        // Step 4: Download assets
        const downloadResult = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
          var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
          var method = helperType.GetMethod("DownloadAssets", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { 
            "${JSON.stringify(assetIds).replace(/"/g, '\\"')}", 
            "", 
            "skip" 
          });
        `);

        const downloadResponse = parseUnityBridgeResult(downloadResult);
        if (downloadResponse && downloadResponse.startsWith("STARTED:")) {
          const parts = downloadResponse.split(":");
          const downloadJobId = parts[1];

          // Poll download until complete
          for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const pollResult = await bridge.executeCode(`
              var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
              var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
              var method = helperType.GetMethod("PollDownloadJob", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
              return (string)method.Invoke(null, new object[] { "${downloadJobId}" });
            `);

            const pollDownloadResponse = parseUnityBridgeResult(pollResult);
            const pollData = JSON.parse(pollDownloadResponse);
            if (pollData.status === "complete") {
              // Step 5: Find asset paths
              const pathsResult = await bridge.executeCode(`
                var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
                var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
                var method = helperType.GetMethod("FindLocalModelPaths", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                return (string)method.Invoke(null, new object[] { "${JSON.stringify(assetIds).replace(/"/g, '\\"')}" });
              `);

              const pathsResponse = parseUnityBridgeResult(pathsResult);
              const pathsData = JSON.parse(pathsResponse);
              if (pathsData.error || !pathsData.paths) {
                return JSON.stringify({ error: true, message: "Failed to find asset paths", details: pathsData }, null, 2);
              }

              const assetPaths = pathsData.paths.map(p => p.prefabPath || p.fbxPath).filter(Boolean);

              // Step 6: Batch place all assets
              const centerX = centerPosition?.x !== undefined ? centerPosition.x : "float.NaN";
              const centerY = centerPosition?.y !== undefined ? centerPosition.y : "float.NaN";
              const centerZ = centerPosition?.z !== undefined ? centerPosition.z : "float.NaN";
              const assetPathsJsonEscaped = JSON.stringify(assetPaths).replace(/"/g, '\\"');

              const placeResult = await bridge.executeCode(`
                var assembly = System.Reflection.Assembly.Load("AnkleBreaker.UnityMCP.Editor");
                var helperType = assembly.GetType("UnityMCP.Editor.MCPInfinityHelper");
                var method = helperType.GetMethod("PlaceSmartBatch", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                return (string)method.Invoke(null, new object[] { 
                  "${assetPathsJsonEscaped}", 
                  "", 
                  ${safeSpacing}f, 
                  ${safeSnap}, 
                  1f, 1f, 1f,
                  ${centerX}f, ${centerY}f, ${centerZ}f,
                  ${safeStrict},
                  "${safePreset}"
                });
              `);

              const parsedPlaceResult = placeResult?.data?.result || placeResult?.result;
              return parsedPlaceResult || JSON.stringify({ error: true, message: "No placement result", details: placeResult }, null, 2);
            } else if (pollData.status === "error") {
              return JSON.stringify({ error: true, message: pollData.error }, null, 2);
            }
          }

          return JSON.stringify({ error: true, message: "Download timeout after 90 seconds" }, null, 2);
        }

        return JSON.stringify({ error: true, message: "Failed to start download", details: downloadResult }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Workflow failed: ${error.message}` }, null, 2);
      }
    },
  },
];
