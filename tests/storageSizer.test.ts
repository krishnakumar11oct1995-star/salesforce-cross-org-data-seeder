import { describe, it, expect } from 'vitest';

describe('Storage Sizing & Sandbox Quota Engine', () => {
  const BYTES_PER_RECORD = 2048; // Standard Salesforce ~2 KB allocation per record
  const DEV_SANDBOX_QUOTA_MB = 200;

  function calculateStorage(rootCount: number, parentCount: number, childCount: number) {
    const totalRecords = rootCount + parentCount + childCount;
    const totalBytes = totalRecords * BYTES_PER_RECORD;
    const estimatedKb = totalBytes / 1024;
    const estimatedMb = estimatedKb / 1024;
    const quotaPercentage = (estimatedMb / DEV_SANDBOX_QUOTA_MB) * 100;

    let warningLevel: 'SAFE' | 'WARNING' | 'CRITICAL' | 'BREACH' = 'SAFE';
    if (quotaPercentage > 100) {
      warningLevel = 'BREACH';
    } else if (quotaPercentage >= 80) {
      warningLevel = 'CRITICAL';
    } else if (quotaPercentage >= 50) {
      warningLevel = 'WARNING';
    }

    return {
      totalRecords,
      estimatedKb,
      estimatedMb,
      quotaPercentage,
      warningLevel
    };
  }

  it('accurately calculates storage footprint for standard 200-record batch with 3 parents and 2 children', () => {
    // 200 roots, 200 * 3 parents = 600 parents, 200 * 2 * 3 children = 1200 children
    const rootCount = 200;
    const parentCount = 600;
    const childCount = 1200;

    const result = calculateStorage(rootCount, parentCount, childCount);

    expect(result.totalRecords).toBe(2000);
    expect(result.estimatedKb).toBe(4000); // 2000 * 2 KB
    expect(parseFloat(result.estimatedMb.toFixed(2))).toBe(3.91);
    expect(result.warningLevel).toBe('SAFE');
    expect(result.quotaPercentage).toBeLessThan(5);
  });

  it('triggers WARNING alert when transfer reaches 50% of 200MB sandbox quota', () => {
    // 50,000 records * 2KB = 100,000 KB = 97.65 MB (~48.8% -> 55,000 records = 107.4 MB = 53.7%)
    const result = calculateStorage(25000, 15000, 15000); // 55,000 total records

    expect(result.totalRecords).toBe(55000);
    expect(result.estimatedMb).toBeGreaterThan(100);
    expect(result.quotaPercentage).toBeGreaterThanOrEqual(50);
    expect(result.warningLevel).toBe('WARNING');
  });

  it('triggers CRITICAL alert when transfer exceeds 80% quota threshold', () => {
    // 85,000 records * 2KB = 170,000 KB = 166.0 MB = 83%
    const result = calculateStorage(40000, 25000, 20000);

    expect(result.quotaPercentage).toBeGreaterThanOrEqual(80);
    expect(result.warningLevel).toBe('CRITICAL');
  });

  it('triggers BREACH alert when payload exceeds 200MB sandbox storage limit', () => {
    // 110,000 records * 2KB = 220,000 KB = 214.8 MB = 107.4%
    const result = calculateStorage(50000, 30000, 30000);

    expect(result.quotaPercentage).toBeGreaterThan(100);
    expect(result.warningLevel).toBe('BREACH');
  });
});
