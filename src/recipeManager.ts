/**
 * RecipeManager: Manages Saved Seeding Recipes (Templates) and Test Data Purging.
 */

import { ApiClient } from './apiClient';
import { assertApiName, formatIdList } from './soqlUtils';
import {
  SeedingRecipe,
  SObjectDescribe,
  StoredTargetOrg
} from './types';

const STORAGE_RECIPES_KEY = 'salesforce_seeding_recipes';

export class RecipeManager {
  /**
   * Retrieves all saved seeding recipes from chrome.storage.local.
   */
  public static async getRecipes(): Promise<SeedingRecipe[]> {
    const result = await chrome.storage.local.get(STORAGE_RECIPES_KEY);
    return (result[STORAGE_RECIPES_KEY] as SeedingRecipe[]) || [];
  }

  /**
   * Saves a new or updated seeding recipe.
   */
  public static async saveRecipe(recipe: SeedingRecipe): Promise<void> {
    const existing = await this.getRecipes();
    const index = existing.findIndex(r => r.id === recipe.id || r.name.toLowerCase() === recipe.name.toLowerCase());

    if (index >= 0) {
      existing[index] = recipe;
    } else {
      existing.push(recipe);
    }

    await chrome.storage.local.set({ [STORAGE_RECIPES_KEY]: existing });
  }

  /**
   * Deletes a saved recipe by ID.
   */
  public static async deleteRecipe(recipeId: string): Promise<void> {
    const existing = await this.getRecipes();
    const filtered = existing.filter(r => r.id !== recipeId);
    await chrome.storage.local.set({ [STORAGE_RECIPES_KEY]: filtered });
  }

  /**
   * Builds a dynamic RecordType translation map (Source RT ID -> Target RT ID) by DeveloperName / Name.
   */
  public static buildRecordTypeTranslationMap(
    sourceDescribe: SObjectDescribe,
    targetDescribe: SObjectDescribe
  ): Map<string, string> {
    const translationMap = new Map<string, string>();
    const sourceRTs = sourceDescribe.recordTypeInfos || [];
    const targetRTs = targetDescribe.recordTypeInfos || [];

    if (sourceRTs.length === 0 || targetRTs.length === 0) {
      return translationMap;
    }

    // Index target record types by developerName (or name fallback)
    const targetMapByName = new Map<string, string>();
    for (const trt of targetRTs) {
      if (trt.developerName) {
        targetMapByName.set(trt.developerName.toLowerCase(), trt.recordTypeId);
      }
      targetMapByName.set(trt.name.toLowerCase(), trt.recordTypeId);
    }

    for (const srt of sourceRTs) {
      const matchKey = (srt.developerName || srt.name).toLowerCase();
      const targetId = targetMapByName.get(matchKey);
      if (targetId) {
        translationMap.set(srt.recordTypeId, targetId);
      }
    }

    return translationMap;
  }

  /**
   * 1-Click Rollback / Purge: Queries target org by External ID and deletes seeded records.
   */
  public static async purgeSeededRecords(
    targetOrg: StoredTargetOrg,
    objectApiName: string,
    extIdFieldName: string,
    sourceRecordIds: string[]
  ): Promise<{ deletedCount: number; errors: string[] }> {
    if (!sourceRecordIds || sourceRecordIds.length === 0) {
      return { deletedCount: 0, errors: [] };
    }

    const records: Array<{ Id: string }> = [];
    const ID_CHUNK_SIZE = 50;
    const safeObject = assertApiName(objectApiName);
    const safeExtField = assertApiName(extIdFieldName);
    const cleanInstanceUrl = targetOrg.instanceUrl.replace(/\/+$/, '');

    for (let i = 0; i < sourceRecordIds.length; i += ID_CHUNK_SIZE) {
      const idChunk = sourceRecordIds.slice(i, i + ID_CHUNK_SIZE);
      const formattedIds = formatIdList(idChunk);
      const soql = `SELECT Id, ${safeExtField} FROM ${safeObject} WHERE ${safeExtField} IN (${formattedIds})`;

      const chunkRecords = await ApiClient.querySOQL<{ Id: string }>(
        targetOrg.instanceUrl,
        targetOrg.accessToken,
        soql,
        2000,
        { targetOrg }
      );

      if (chunkRecords && Array.isArray(chunkRecords)) {
        records.push(...chunkRecords);
      }
    }

    if (records.length === 0) {
      return { deletedCount: 0, errors: ['No seeded records found matching given source IDs.'] };
    }

    const targetIdsToDelete = records.map(r => r.Id);
    let deletedCount = 0;
    const errors: string[] = [];

    // Delete in chunks of 200 via composite sobjects delete
    for (let i = 0; i < targetIdsToDelete.length; i += 200) {
      const chunk = targetIdsToDelete.slice(i, i + 200);
      const deleteUrl = `${cleanInstanceUrl}/services/data/v61.0/composite/sobjects?ids=${chunk.join(',')}&allOrNone=false`;

      const results = await ApiClient.executeRequest<Array<{ id: string; success: boolean; errors: Array<{ message: string }> }>>(
        deleteUrl,
        targetOrg.accessToken,
        { method: 'DELETE' }
      );

      for (const res of results) {
        if (res.success) {
          deletedCount++;
        } else if (res.errors && res.errors.length > 0) {
          errors.push(res.errors.map(e => e.message).join('; '));
        }
      }
    }

    return { deletedCount, errors };
  }
}
