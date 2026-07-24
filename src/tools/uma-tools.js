// AnkleBreaker Unity MCP - UMA (Unity Multipurpose Avatar) tool definitions
// These tools are only functional when UMA is installed in the Unity project.
// The C# side is wrapped in #if UMA_INSTALLED - calls will return an error if UMA is absent.
import * as bridge from "../uma-bridge.js";
import { formatResult } from "../response-format.js";

export const umaTools = [
  {
    name: "unity_uma_inspect_fbx",
    description:
      "Inspect an FBX file to list all SkinnedMeshRenderers with vertex counts, weighted bones (keepList), and bone counts. " +
      "Essential first step before creating UMA slots — shows which SMRs are available and their bone data.",
    inputSchema: {
      type: "object",
      properties: {
        fbxPath: {
          type: "string",
          description: "Asset path to the FBX file (e.g. 'Assets/Models/Armor.fbx')",
        },
      },
      required: ["fbxPath"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaInspectFbx(params)),
  },
  {
    name: "unity_uma_create_slot",
    description:
      "Create a UMA SlotDataAsset from an FBX SkinnedMeshRenderer. Automatically extracts weighted bones for keepList, " +
      "fixes SlotName, initializes tags/Races arrays, and cleans up subfolder/parasite artifacts. " +
      "Use unity_uma_inspect_fbx first to see available SMRs.\n\nEXAMPLE CALL:\n{\n  \"fbxPath\": \"Assets/Models/Armor/SK_Hu_M_IronChest.fbx\",\n  \"smrName\": \"Chest\",\n  \"slotName\": \"PT_Iron_Chest\",\n  \"outputFolder\": \"Assets/UMA/Slots/Armor\",\n  \"umaMaterialPath\": \"Assets/UMA/Content/UMA_Core/MaterialSamples/UMA_ClothesBase.asset\"\n}",
    inputSchema: {
      type: "object",
      properties: {
        fbxPath: {
          type: "string",
          description: "Asset path to the FBX (e.g. 'Assets/Models/Armor.fbx')",
        },
        smrName: {
          type: "string",
          description: "Name of the SkinnedMeshRenderer inside the FBX (from inspect_fbx results)",
        },
        slotName: {
          type: "string",
          description: "Name for the created SlotDataAsset (e.g. 'PT_Iron_Chest')",
        },
        outputFolder: {
          type: "string",
          description: "Folder to save the slot asset (e.g. 'Assets/UMA/Slots/Armor')",
        },
        umaMaterialPath: {
          type: "string",
          description: "FULL asset path (NOT just the name) to the UMAMaterial. Must start with 'Assets/' and end with '.asset'. Example: 'Assets/UMA/Content/UMA_Core/MaterialSamples/UMA_ClothesBase.asset'",
        },
        keepAllBones: {
          type: "boolean",
          description: "If true, keep all bones instead of only weighted ones (default: false — auto-extracts keepList)",
        },
      },
      required: ["fbxPath", "smrName", "slotName", "outputFolder", "umaMaterialPath"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaCreateSlot(params)),
  },
  {
    name: "unity_uma_create_overlay",
    description:
      "Create a UMA OverlayDataAsset with the correct number of texture channels based on the UMA Material. " +
      "Assigns textures to channels (diffuse, normal, etc.).\n\nEXAMPLE CALL:\n{\n  \"overlayName\": \"PT_Iron_Chest_Overlay\",\n  \"outputFolder\": \"Assets/UMA/Overlays/Armor\",\n  \"umaMaterialPath\": \"Assets/UMA/Content/UMA_Core/MaterialSamples/UMA_ClothesBase.asset\",\n  \"textures\": [\"Assets/Textures/Chest_D.png\", \"Assets/Textures/Chest_N.png\", \"Assets/Textures/Chest_MR.png\"]\n}\n\nCRITICAL: textures MUST be a flat JSON array of strings. Do NOT use dict format like {\"0\":\"path\"}. Parameter is outputFolder, NOT savePath.",
    inputSchema: {
      type: "object",
      properties: {
        overlayName: {
          type: "string",
          description: "Name for the overlay asset (e.g. 'PT_Iron_Chest_Overlay')",
        },
        outputFolder: {
          type: "string",
          description: "Folder to save the overlay (e.g. 'Assets/UMA/Overlays/Armor')",
        },
        umaMaterialPath: {
          type: "string",
          description: "FULL asset path (NOT just the name) to the UMAMaterial. Must start with 'Assets/' and end with '.asset'. Example: 'Assets/UMA/Content/UMA_Core/MaterialSamples/UMA_ClothesBase.asset'. Must match the slot's material.",
        },
        textures: {
          type: "array",
          description: "Ordered array of texture asset paths, one per UMAMaterial channel index. Index 0 = diffuse/albedo, index 1 = normal map, index 2 = metallic/roughness. Use null or empty string for unused channels. Example: [\"Assets/Textures/Chest_D.png\", \"Assets/Textures/Chest_N.png\", null]. Do NOT use channel0/channel1/channel2 object format — must be a flat array of strings.",
          items: { type: "string" },
        },
      },
      required: ["overlayName", "outputFolder", "umaMaterialPath", "textures"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaCreateOverlay(params)),
  },
  {
    name: "unity_uma_create_wardrobe_recipe",
    description:
      "Create a UMA WardrobeRecipe that binds slots and overlays together as an equippable item. " +
      "Handles the complex recipeString v3 JSON format, fColors, Hides, DisplayValue, and compatibleRaces. " +
      "Slots and overlays must already exist.\n\nEXAMPLE CALL:\n{\n  \"recipeName\": \"PT_Iron_Chest_Recipe\",\n  \"outputFolder\": \"Assets/UMA/Recipes/Armor\",\n  \"wardrobeSlot\": \"Chest\",\n  \"compatibleRaces\": [\"HumanMaleDCS\"],\n  \"slots\": [\n    {\n      \"slotName\": \"PT_Iron_Chest\",\n      \"overlays\": [{\"overlayName\": \"PT_Iron_Chest_Overlay\"}]\n    }\n  ]\n}\n\nFor multi-sub-mesh items, add one slot entry per sub-mesh, each with its own overlay.",
    inputSchema: {
      type: "object",
      properties: {
        recipeName: {
          type: "string",
          description: "Name for the wardrobe recipe (e.g. 'PT_Iron_Chest_Recipe')",
        },
        outputFolder: {
          type: "string",
          description: "Folder to save the recipe (e.g. 'Assets/UMA/Recipes/Armor')",
        },
        wardrobeSlot: {
          type: "string",
          description: "Wardrobe slot name (e.g. 'Chest', 'Legs', 'Feet')",
        },
        compatibleRaces: {
          type: "array",
          description: "Array of race names this recipe is compatible with (e.g. ['HumanMaleDCS', 'HumanFemaleDCS'])",
          items: { type: "string" },
        },
        slots: {
          type: "array",
          description:
            "Array of slot objects. Each slot has a slotName (the SlotDataAsset name) and an overlays array. " +
            "Each overlay has overlayName and optional channelCount (default 3). " +
            "For backward compatibility, a single overlayName at slot level is also accepted but overlays array is preferred.",
          items: {
            type: "object",
            properties: {
              slotName: {
                type: "string",
                description: "Name of the SlotDataAsset (e.g. 'Boots_Peasant_Armor')",
              },
              overlays: {
                type: "array",
                description: "Array of overlays stacked on this slot. Order matters: first overlay is the base layer.",
                items: {
                  type: "object",
                  properties: {
                    overlayName: {
                      type: "string",
                      description: "Name of the OverlayDataAsset (e.g. 'Boots_Peasant_Armor_Overlay')",
                    },
                    channelCount: {
                      type: "number",
                      description: "Number of texture channels for this overlay (default: 3 = diffuse+normal+mask)",
                    },
                  },
                  required: ["overlayName"],
                },
              },
              overlayName: {
                type: "string",
                description: "DEPRECATED: use overlays array instead. Single overlay name for backward compat.",
              },
              channelCount: {
                type: "number",
                description: "DEPRECATED: use overlays[].channelCount instead. Channel count when using single overlayName.",
              },
            },
            required: ["slotName"],
          },
        },
        hides: {
          type: "array",
          description: "Optional array of slot names to hide when this recipe is equipped (e.g. ['MaleUnderwear'])",
          items: { type: "string" },
        },
        displayValue: {
          type: "string",
          description: "Optional display name shown in character creator UI",
        },
      },
      required: ["recipeName", "outputFolder", "wardrobeSlot", "compatibleRaces", "slots"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaCreateWardrobeRecipe(params)),
  },
  {
    name: "unity_uma_register_assets",
    description:
      "Register UMA assets (Slot, Overlay, or WardrobeRecipe) in the UMA Global Library so they are available at runtime. " +
      "Must be called after creating assets.",
    inputSchema: {
      type: "object",
      properties: {
        assetPaths: {
          type: "array",
          description: "Array of asset paths to register. Optional if folderPath is provided.",
          items: { type: "string" },
        },
        folderPath: {
          type: "string",
          description: "Folder to scan recursively for all UMA assets (Slots, Overlays, Recipes). Alternative to listing each path manually.",
        },
      },
    },
    handler: async (params) =>
      formatResult(await bridge.umaRegisterAssets(params)),
  },
  {
    name: "unity_uma_list_global_library",
    description:
      "List assets registered in the UMA Global Library. Can filter by type (Slot, Overlay, Race, WardrobeRecipe) and/or name pattern.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Filter by asset type. Accepts short names: 'Slot', 'Overlay', 'Race', 'WardrobeRecipe', full C# names: 'SlotDataAsset', 'OverlayDataAsset', 'RaceData', 'UMAWardrobeRecipe', or 'All' (default). Case-insensitive.",
        },
        nameFilter: {
          type: "string",
          description: "Optional substring filter on asset names (case-insensitive)",
        },
      },
    },
    handler: async (params) =>
      formatResult(await bridge.umaListGlobalLibrary(params)),
  },
  {
    name: "unity_uma_list_wardrobe_slots",
    description:
      "List all wardrobe slot names available for a given UMA race (e.g. 'Chest', 'Legs', 'Feet', 'Helmet').",
    inputSchema: {
      type: "object",
      properties: {
        raceName: {
          type: "string",
          description: "UMA race name (e.g. 'HumanMaleDCS')",
        },
      },
      required: ["raceName"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaListWardrobeSlots(params)),
  },
  {
    name: "unity_uma_list_uma_materials",
    description:
      "List all UMAMaterial assets in the project with their channel counts. Useful for choosing the right material when creating slots and overlays.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (params) =>
      formatResult(await bridge.umaListUMAMaterials(params)),
  },
  {
    name: "unity_uma_get_project_config",
    description:
      "Get project-specific UMA configuration by querying existing assets. Returns detected races, UMA materials, wardrobe slots, and recipe patterns. Call this before creating slots/overlays/recipes to auto-detect correct parameters.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (params) =>
      formatResult(await bridge.umaGetProjectConfig(params)),
  },
  {
    name: "unity_uma_verify_recipe",
    description:
      "Validate a UMA WardrobeRecipe by checking that all referenced slots and overlays exist in the Global Library, " +
      "that materialName is set on slots, and that fColors has enough entries for the colorIdx values used. " +
      "Returns a list of issues (critical/warning) and a valid/invalid verdict. Essential post-creation check.",
    inputSchema: {
      type: "object",
      properties: {
        recipePath: {
          type: "string",
          description: "Asset path to the WardrobeRecipe to verify (e.g. 'Assets/UMA/Recipes/MyRecipe.asset')",
        },
      },
      required: ["recipePath"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaVerifyRecipe(params)),
  },
  {
    name: "unity_uma_rebuild_global_library",
    description:
      "Rebuild or repair the UMA Global Library (UMAAssetIndexer). " +
      "Use this when assets are missing from the library, after bulk creation/deletion, " +
      "or when the library is in a corrupted state.\n\n" +
      "MODES:\n" +
      "- 'rebuild' (default): Full rebuild from project. Clears the library, rescans all UMA assets, and re-registers them. " +
      "Equivalent to the 'Rebuild From Project' button in the UMA Global Library inspector.\n" +
      "- 'rebuild_with_text': Same as rebuild but also includes UMATextRecipe assets.\n" +
      "- 'repair': Light repair. Rebuilds type tables and removes broken/invalid entries without a full rescan. Faster but less thorough.\n\n" +
      "Returns asset counts before and after the operation with a breakdown by type (slots, overlays, recipes, races).",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Rebuild mode: 'rebuild' (full rescan, default), 'rebuild_with_text' (full + text recipes), or 'repair' (light cleanup).",
          enum: ["rebuild", "rebuild_with_text", "repair"],
        },
      },
    },
    handler: async (params) =>
      formatResult(await bridge.umaRebuildGlobalLibrary(params)),
  },
  {
    name: "unity_uma_create_wardrobe_from_fbx",
    description:
      "Create all UMA assets from a single FBX file in one atomic call. " +
      "Inspects the FBX for sub-meshes, creates SlotDataAssets (via UMA's CreateSlotData), " +
      "creates OverlayDataAssets with texture deduplication, assembles WardrobeRecipes (recipeString v3), " +
      "and registers everything in the Global Library. Supports multiple texture variants in a single call. " +
      "This replaces the manual 5-step workflow (inspect + create-slot + create-overlay + create-recipe + register).\n\n" +
      "TEXTURE DETECTION: Textures are always read automatically from the Unity materials assigned to each FBX sub-mesh. " +
      "No manual texture paths needed. Each variant reads from the FBX sharedMaterials (diffuse, normal, metallic/roughness).\n\n" +
      "EXAMPLE (single variant):\n" +
      "{ fbxPath: 'Assets/Models/Armor/SK_Hu_M_IronChest.fbx', outputFolder: 'Assets/UMA/Generated/IronChest', " +
      "wardrobeSlot: 'Chest', umaMaterialPath: 'Assets/UMA/.../UMA_ClothesBase.asset', variants: [{ suffix: 'Iron' }] }\n\n" +
      "EXAMPLE (two variants from same FBX):\n" +
      "{ ..., variants: [{ suffix: 'Peasant' }, { suffix: 'Noble' }] }\n\n" +
      "CRITICAL RULES:\n" +
      "- variants[].suffix is REQUIRED (not name or variantName)\n" +
      "- Textures are always auto-read from FBX materials - no texture paths needed\n" +
      "- umaMaterialPath MUST be a full path starting with Assets/ and ending with .asset\n" +
      "- For custom texture control, use the individual tools (create_slot, create_overlay, create_wardrobe_recipe) instead",
    inputSchema: {
      type: "object",
      properties: {
        fbxPath: {
          type: "string",
          description: "Asset path to the FBX file (e.g. 'Assets/Models/Armor/SK_Hu_M_IronChest.fbx')",
        },
        outputFolder: {
          type: "string",
          description: "Root folder for generated assets (e.g. 'Assets/UMA/GeneratedAssets/IronChest'). Sub-folders Slots/, Overlays/, Recipes/ are created automatically.",
        },
        wardrobeSlot: {
          type: "string",
          description: "Wardrobe slot name (e.g. 'Chest', 'Legs', 'Feet', 'Head')",
        },
        umaMaterialPath: {
          type: "string",
          description: "FULL asset path (NOT just the name) to the UMAMaterial to assign to all slots. Must start with 'Assets/' and end with '.asset'. Example: 'Assets/UMA/Content/UMA_Core/MaterialSamples/UMA_ClothesBase.asset'",
        },
        variants: {
          type: "array",
          description:
            "Array of variant definitions. Each variant produces one WardrobeRecipe. " +
            "Textures are auto-read from FBX materials for each sub-mesh. " +
            "If two sub-meshes share identical textures they share the same overlay (deduplication).",
          items: {
            type: "object",
            properties: {
              suffix: {
                type: "string",
                description: "Suffix used in asset naming for this variant (e.g. 'Iron', 'Gold', 'Peasant'). Appended to slot/overlay/recipe names.",
              },
            },
            required: ["suffix"],
          },
        },
        recipeName: {
          type: "string",
          description: "Optional base name for recipes. Defaults to FBX filename with prefix stripped (e.g. SK_Hu_M_ removed). Each variant appends _{suffix}_Recipe.",
        },
        race: {
          type: "string",
          description: "Race name for compatible races (default: auto-detect from FBX prefix, e.g. SK_Hu_M_ = HumanMaleDCS)",
        },
        registerInGlobalLibrary: {
          type: "boolean",
          description: "Whether to register all created assets in the UMA Global Library (default: true)",
        },
        verifyAfterCreation: {
          type: "boolean",
          description: "Whether to run VerifyRecipe on each created recipe after assembly (default: true)",
        },
      },
      required: ["fbxPath", "outputFolder", "wardrobeSlot", "umaMaterialPath", "variants"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaCreateWardrobeFromFbx(params)),
  },
  {
    name: "unity_uma_wardrobe_equip",
    description:
      "Equip or unequip a UMA wardrobe recipe on a DynamicCharacterAvatar in the scene. " +
      "Automatically detects Play/Edit mode and uses the correct API path:\n" +
      "- Play Mode: Uses runtime DCA API (SetSlot/ClearSlot + BuildCharacter)\n" +
      "- Edit Mode: Modifies serialized preloadWardrobeRecipes list + triggers visual rebuild via GenerateSingleUMA\n\n" +
      "To UNEQUIP a slot, pass recipeName as null or omit it.\n\n" +
      "EXAMPLE (equip):\n" +
      '{ "gameObjectPath": "PlayerPrefabv2_TestWardrobe", "wardrobeSlot": "Helmet", "recipeName": "Helm_Peasant_Bl_Recipe" }\n\n' +
      "EXAMPLE (unequip):\n" +
      '{ "gameObjectPath": "PlayerPrefabv2_TestWardrobe", "wardrobeSlot": "Helmet", "recipeName": null }\n\n' +
      "WARDROBE SLOTS: Waist, Feet, Shoulders, Chest, Helmet, Legs, Hands, Hair, Complexion, Eyebrows, Beard, Eyes, Face, Ears, Underwear",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: {
          type: "string",
          description:
            "Hierarchy path to the GameObject (or its parent) containing DynamicCharacterAvatar (e.g. 'PlayerPrefabv2_TestWardrobe')",
        },
        wardrobeSlot: {
          type: "string",
          description:
            "UMA wardrobe slot name: 'Waist', 'Feet', 'Shoulders', 'Chest', 'Helmet', 'Legs', 'Hands', etc.",
        },
        recipeName: {
          type: ["string", "null"],
          description:
            "Recipe asset name (e.g. 'Helm_Peasant_Bl_Recipe'). null or omitted = unequip (clear the slot)",
        },
      },
      required: ["gameObjectPath", "wardrobeSlot"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaWardrobeEquip(params)),
  },
  {
    name: "unity_uma_edit_race",
    description:
      "Edit properties of an existing UMA RaceData asset. Supports renaming (with automatic cascade " +
      "to all WardrobeRecipes, base recipe, and DCA in scene), modifying wardrobe slots, physics " +
      "properties, tags, and cross-compatibility settings.\n\n" +
      "RENAME CASCADE: When newRaceName is provided, automatically updates:\n" +
      "- The base recipe (compatibleRaces + recipeString JSON)\n" +
      "- All UMATextRecipe/WardrobeRecipe whose compatibleRaces or recipeString references the old name\n" +
      "- All DynamicCharacterAvatars in the current scene (activeRace.name)\n" +
      "- The .asset filename on disk\n" +
      "- The UMA Global Library\n\n" +
      "EXAMPLE (rename):\n" +
      '{ "raceName": "HumanRace", "newRaceName": "HumanMaleRace" }\n\n' +
      "EXAMPLE (add wardrobe slot):\n" +
      '{ "raceName": "HumanMaleRace", "addWardrobeSlots": ["TorsoAdditional"] }\n\n' +
      "EXAMPLE (full edit):\n" +
      '{ "raceName": "HumanRace", "newRaceName": "HumanMaleRace", ' +
      '"raceHeight": 1.8, "tags": ["playable", "male"] }',
    inputSchema: {
      type: "object",
      properties: {
        raceName: {
          type: "string",
          description:
            "Current race name to edit (looked up in Global Library). Provide this OR racePath.",
        },
        racePath: {
          type: "string",
          description:
            "Direct asset path to the RaceData (e.g. 'Assets/.../HumanRace.asset'). Alternative to raceName.",
        },
        newRaceName: {
          type: "string",
          description:
            "New name for the race. Triggers cascade update on all recipes, DCA, and asset file.",
        },
        wardrobeSlots: {
          type: "array",
          description:
            "Complete replacement of wardrobe slot list. Mutually exclusive with addWardrobeSlots/removeWardrobeSlots.",
          items: { type: "string" },
        },
        addWardrobeSlots: {
          type: "array",
          description: "Slots to add to the existing list (no duplicates).",
          items: { type: "string" },
        },
        removeWardrobeSlots: {
          type: "array",
          description: "Slots to remove from the existing list.",
          items: { type: "string" },
        },
        umaTarget: {
          type: "string",
          description: "'Humanoid' or 'Generic'.",
          enum: ["Humanoid", "Generic"],
        },
        fixupRotations: {
          type: "boolean",
          description: "Set to true for Blender FBX slots.",
        },
        tags: {
          type: "array",
          description: "Replace all tags on the race.",
          items: { type: "string" },
        },
        backwardsCompatibleWith: {
          type: "array",
          description: "Race names this race is cross-compatible with.",
          items: { type: "string" },
        },
        raceHeight: { type: "number", description: "Race default height." },
        raceRadius: { type: "number", description: "Race default radius." },
        raceMass: { type: "number", description: "Race default mass." },
        baseRaceRecipePath: {
          type: "string",
          description:
            "Asset path to a new base race recipe (UMATextRecipe) to assign. Only if changing the base recipe reference.",
        },
        updateRecipes: {
          type: "boolean",
          description:
            "When renaming, update compatibleRaces + recipeString in all recipes (default: true).",
        },
        updateDCA: {
          type: "boolean",
          description:
            "When renaming, update DCA in current scene (default: true).",
        },
        renameAssetFile: {
          type: "boolean",
          description:
            "When renaming, also rename the .asset file on disk (default: true).",
        },
        rebuildLibrary: {
          type: "boolean",
          description:
            "Rebuild UMA Global Library after modifications (default: true).",
        },
      },
    },
    handler: async (params) =>
      formatResult(await bridge.umaEditRace(params)),
  },
  {
    name: "unity_uma_create_race",
    description:
      "Create a new UMA RaceData asset. Two modes:\n\n" +
      "DUPLICATE MODE (recommended): Provide sourceRaceName to copy all settings from an existing race. " +
      "The base recipe is automatically duplicated with the new race name in recipeString and compatibleRaces. " +
      "Any optional parameter overrides the duplicated value.\n\n" +
      "SCRATCH MODE: Omit sourceRaceName to create from scratch with sensible defaults " +
      "(Humanoid, standard wardrobe slots, default physics). No base recipe is created — assign one via edit_race.\n\n" +
      "EXAMPLE (duplicate):\n" +
      '{ "raceName": "HumanFemaleRace", "sourceRaceName": "HumanMaleRace" }\n\n' +
      "EXAMPLE (duplicate with overrides):\n" +
      '{ "raceName": "HumanFemaleRace", "sourceRaceName": "HumanMaleRace", ' +
      '"raceHeight": 1.85, "tags": ["playable", "female"] }\n\n' +
      "EXAMPLE (from scratch):\n" +
      '{ "raceName": "DwarfRace", "outputFolder": "Assets/UMA/Races", ' +
      '"wardrobeSlots": ["Chest", "Legs", "Feet", "Helmet"], "raceHeight": 1.2 }\n\n' +
      "FBX MODE: Provide fbxPath + umaMaterialPath to create a full race from an FBX body mesh. " +
      "Inspects the FBX, creates body SlotDataAssets (one per SMR), OverlayDataAssets with auto-detected " +
      "textures, and assembles a base race recipe (UMATextRecipe). Optionally combine with sourceRaceName " +
      "to copy wardrobeSlots/physics from an existing race.\n\n" +
      "EXAMPLE (FBX mode):\n" +
      '{ "raceName": "HumanFemaleRace", "fbxPath": "Assets/.../SK_Hu_F_FullBody.fbx", ' +
      '"umaMaterialPath": "Assets/.../UMA_ClothesBase.asset", "outputFolder": "Assets/UMA/Races/Female" }\n\n' +
      "EXAMPLE (FBX + copy settings from existing race):\n" +
      '{ "raceName": "HumanFemaleRace", "sourceRaceName": "HumanMaleRace", ' +
      '"fbxPath": "Assets/.../SK_Hu_F_FullBody.fbx", "umaMaterialPath": "Assets/.../UMA_ClothesBase.asset" }',
    inputSchema: {
      type: "object",
      properties: {
        raceName: {
          type: "string",
          description: "Name for the new race (REQUIRED). Must be unique.",
        },
        sourceRaceName: {
          type: "string",
          description:
            "Name of an existing race to duplicate from (Global Library lookup). If provided, enters duplicate mode.",
        },
        sourceRacePath: {
          type: "string",
          description:
            "Direct asset path to the source RaceData. Alternative to sourceRaceName.",
        },
        outputFolder: {
          type: "string",
          description:
            "Folder to save the new RaceData (and base recipe). Defaults to same folder as source race in duplicate mode.",
        },
        wardrobeSlots: {
          type: "array",
          description: "Wardrobe slot list. In duplicate mode, overrides the source's list.",
          items: { type: "string" },
        },
        umaTarget: {
          type: "string",
          description: "'Humanoid' (default) or 'Generic'.",
          enum: ["Humanoid", "Generic"],
        },
        fixupRotations: {
          type: "boolean",
          description: "Set to true for Blender FBX slots (default: copies source or true).",
        },
        tags: {
          type: "array",
          description: "Tags for the new race.",
          items: { type: "string" },
        },
        fbxPath: {
          type: "string",
          description:
            "Asset path to a body FBX file (e.g. 'Assets/.../SK_Hu_F_FullBody.fbx'). " +
            "Enables FBX mode: creates body slots, overlays, and base race recipe from the FBX.",
        },
        umaMaterialPath: {
          type: "string",
          description:
            "FULL asset path to the UMAMaterial for body slots (required in FBX mode). " +
            "Must start with 'Assets/' and end with '.asset'.",
        },
        backwardsCompatibleWith: {
          type: "array",
          description: "Cross-compatible race names.",
          items: { type: "string" },
        },
        raceHeight: { type: "number", description: "Default height (default: 2.0)." },
        raceRadius: { type: "number", description: "Default radius (default: 0.25)." },
        raceMass: { type: "number", description: "Default mass (default: 50)." },
        duplicateBaseRecipe: {
          type: "boolean",
          description:
            "In duplicate mode, also duplicate the base recipe with updated race name (default: true).",
        },
        registerInLibrary: {
          type: "boolean",
          description: "Register the new race in the UMA Global Library (default: true).",
        },
      },
      required: ["raceName"],
    },
    handler: async (params) =>
      formatResult(await bridge.umaCreateRace(params)),
  },
];
