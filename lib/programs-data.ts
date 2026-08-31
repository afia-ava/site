import { parseRecord, siteBaseUrl, siteAuthHeaders, SITE_FIELDS } from "./site-programs";
import type { AirtableProgram } from "./programs";

const BASE_ID = "app3A5kJwYqxMLOgh";
const TABLE_NAME = "YSWS Programs";
const PROGRAMS_REVALIDATE_SECONDS = 300;
export const PROGRAMS_CACHE_TAG = "programs";

type FetchProgramsOptions = {
  fresh?: boolean;
};

export function hasKey(): boolean {
  return Boolean(process.env.AIRTABLE_API_KEY?.trim());
}

function createFetchOptions(fresh: boolean): RequestInit {
  return fresh
    ? { cache: "no-store" }
    : { next: { revalidate: PROGRAMS_REVALIDATE_SECONDS, tags: [PROGRAMS_CACHE_TAG] } };
}

type AirtableListResponse = {
  records?: unknown[];
  offset?: string;
};

async function fetchAllPages(
  url: string,
  headers: Record<string, string>,
  fetchOptions: RequestInit,
): Promise<unknown[]> {
  const records: unknown[] = [];
  let offset: string | undefined;

  do {
    const pageUrl = new URL(url);
    if (offset) pageUrl.searchParams.set("offset", offset);

    const response = await fetch(pageUrl, { ...fetchOptions, headers });
    if (!response.ok) {
      throw new Error(`Airtable error ${response.status}: ${await response.text()}`);
    }

    const page = (await response.json()) as AirtableListResponse;
    records.push(...(page.records ?? []));
    offset = page.offset;
  } while (offset);

  return records;
}

async function readPrograms({ fresh = false }: FetchProgramsOptions = {}): Promise<
  AirtableProgram[]
> {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return [];
  }

  const params = new URLSearchParams();
  params.set("filterByFormula", "NOT({Start Date}='')");
  params.append("fields[]", "Name");
  params.append("fields[]", "Start Date");
  params.append("fields[]", "End Date");
  params.append("fields[]", "Website URL");
  params.append("sort[0][field]", "End Date");
  params.append("sort[0][direction]", "asc");

  const siteKey = process.env.HACK_CLUB_SITE_AIRTABLE_KEY;
  const fetchOptions = createFetchOptions(fresh);

  const [ywswRecords, siteRecords] = await Promise.all([
    fetchAllPages(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?${params}`,
      { Authorization: `Bearer ${apiKey}` },
      fetchOptions,
    ),
    siteKey
      ? fetchAllPages(
          `${siteBaseUrl()}?${SITE_FIELDS.map((field) => `fields[]=${encodeURIComponent(field)}`).join("&")}`,
          siteAuthHeaders(siteKey),
          fetchOptions,
        ).catch(() => [] as unknown[])
      : Promise.resolve([]),
  ]);
  const siteMap = new Map(
    siteRecords.map((record) => {
      const parsed = parseRecord(record as Parameters<typeof parseRecord>[0]);
      return [parsed.programName, parsed] as const;
    }),
  );

  return ywswRecords.map((rawRecord) => {
    const record = rawRecord as { id: string; fields: Record<string, string> };
    const name = record.fields["Name"] ?? "Unnamed";
    const websiteUrl = record.fields["Website URL"]?.trim();
    return {
      id: record.id,
      name,
      startDate: record.fields["Start Date"],
      endDate: record.fields["End Date"] || null,
      websiteUrl: websiteUrl
        ? /^https?:\/\//i.test(websiteUrl)
          ? websiteUrl
          : `https://${websiteUrl}`
        : null,
      site: siteMap.get(name) ?? null,
    };
  });
}

export async function fetchPrograms(): Promise<AirtableProgram[]> {
  try {
    return await readPrograms();
  } catch (error) {
    console.error("[programs] fetch failed", error);
    return [];
  }
}

export async function fetchProgramsFresh(): Promise<AirtableProgram[]> {
  return readPrograms({ fresh: true });
}
