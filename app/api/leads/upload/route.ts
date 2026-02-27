import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Papa from 'papaparse';
import { CSVRow } from '@/types';

const LINKEDIN_URL_PATTERN = /linkedin\.com\/(in|pub)\//i;

function normalizeLinkedInUrl(url: string): string | null {
  if (!url) return null;
  const cleaned = url.trim();
  if (!LINKEDIN_URL_PATTERN.test(cleaned)) return null;
  // Normalize to https://linkedin.com/in/username
  return cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
}

function extractLinkedInUrl(row: CSVRow): string | null {
  const fields = ['linkedin_url', 'linkedin_profile_url', 'profile_url', 'LinkedIn URL', 'linkedin'];
  for (const field of fields) {
    if (row[field]) {
      const url = normalizeLinkedInUrl(row[field] as string);
      if (url) return url;
    }
  }
  return null;
}

// POST /api/leads/upload - CSV upload
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const campaignId = formData.get('campaign_id') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!campaignId) {
      return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 });
    }

    // Verify campaign ownership
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Parse CSV
    const csvText = await file.text();
    const { data: rows, errors } = Papa.parse<CSVRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
    });

    if (errors.length > 0 && rows.length === 0) {
      return NextResponse.json({ error: 'Failed to parse CSV file' }, { status: 400 });
    }

    // Transform rows to leads
    const leadsToInsert = [];
    let invalidCount = 0;

    for (const row of rows) {
      const linkedinUrl = extractLinkedInUrl(row as CSVRow);
      if (!linkedinUrl) {
        invalidCount++;
        continue;
      }

      // Get full name
      const firstName = (row.first_name as string)?.trim() || '';
      const lastName = (row.last_name as string)?.trim() || '';
      const fullName = (row.full_name as string)?.trim() || (row.name as string)?.trim() || 
                       [firstName, lastName].filter(Boolean).join(' ') || '';

      // Extract known fields, rest goes to custom_fields
      const knownFields = ['linkedin_url', 'linkedin_profile_url', 'profile_url', 'first_name', 
                           'last_name', 'full_name', 'name', 'company', 'company_name', 'title', 
                           'job_title', 'email', 'phone'];
      const customFields: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        if (!knownFields.includes(key) && value) {
          customFields[key] = String(value);
        }
      }

      leadsToInsert.push({
        campaign_id: campaignId,
        linkedin_url: linkedinUrl,
        first_name: firstName || null,
        last_name: lastName || null,
        full_name: fullName || null,
        company: ((row.company as string) || (row.company_name as string))?.trim() || null,
        title: ((row.title as string) || (row.job_title as string))?.trim() || null,
        email: (row.email as string)?.trim() || null,
        phone: (row.phone as string)?.trim() || null,
        custom_fields: Object.keys(customFields).length > 0 ? customFields : {},
        status: 'pending',
      });
    }

    if (leadsToInsert.length === 0) {
      return NextResponse.json({
        error: 'No valid leads found. Make sure your CSV has a "linkedin_url" column.',
        total_rows: rows.length,
        invalid: invalidCount,
        inserted: 0,
        duplicates: 0,
      }, { status: 400 });
    }

    // Fetch existing linkedin_urls for this campaign to detect duplicates manually
    const { data: existing } = await supabase
      .from('leads')
      .select('linkedin_url')
      .eq('campaign_id', campaignId);

    const existingUrls = new Set((existing || []).map((r: { linkedin_url: string }) => r.linkedin_url));

    const newLeads = leadsToInsert.filter(l => !existingUrls.has(l.linkedin_url));
    const duplicates = leadsToInsert.length - newLeads.length;

    const BATCH_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < newLeads.length; i += BATCH_SIZE) {
      const batch = newLeads.slice(i, i + BATCH_SIZE);
      const { data, error: insertError } = await supabase
        .from('leads')
        .insert(batch)
        .select('id');

      if (insertError) {
        console.error('Insert error:', insertError.message);
        continue;
      }

      inserted += data?.length || 0;
    }

    return NextResponse.json({
      inserted,
      duplicates,
      invalid: invalidCount,
      total_rows: rows.length,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('CSV upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}