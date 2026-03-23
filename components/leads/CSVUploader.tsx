'use client';

import { useState, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';
import { SectionCard } from '@/components/ui/section-card';

interface CSVUploaderProps {
  campaignId: string;
  onSuccess?: () => void;
}

export default function CSVUploader({ campaignId, onSuccess }: CSVUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; duplicates: number; invalid: number; total_rows: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith('.csv')) { setFile(dropped); setResult(null); }
    else toast.error('Please upload a CSV file');
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) { setFile(selected); setResult(null); }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('campaign_id', campaignId);
      const { data } = await axios.post('/api/leads/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      toast.success(`Imported ${data.inserted} leads`);
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error || 'Upload failed');
    } finally { setUploading(false); }
  };

  return (
    <SectionCard title="Import Leads from CSV">
      {/* Info */}
      <div className="bg-indigo-50 rounded-lg p-3 mb-4 text-xs">
        <p className="font-medium text-indigo-700 mb-0.5">Required column: <code className="bg-white px-1 rounded">linkedin_url</code></p>
        <p className="text-indigo-500">Optional: first_name, last_name, company, title, email, phone</p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => document.getElementById('csv-input')?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'}`}
      >
        <input id="csv-input" type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileText className="h-7 w-7 text-indigo-600" />
            <div className="text-left">
              <p className="text-sm font-medium text-zinc-900">{file.name}</p>
              <p className="text-xs text-zinc-400">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button onClick={e => { e.stopPropagation(); setFile(null); setResult(null); }} className="ml-2 p-1.5 hover:bg-zinc-100 rounded-lg transition-colors">
              <X className="h-4 w-4 text-zinc-400" />
            </button>
          </div>
        ) : (
          <div>
            <Upload className="h-7 w-7 text-zinc-300 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">Drop your CSV here or <span className="text-indigo-600">browse</span></p>
            <p className="text-xs text-zinc-400 mt-1">Supports .csv files</p>
          </div>
        )}
      </div>

      {file && !result && (
        <button onClick={handleUpload} disabled={uploading} className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</> : <><Upload className="h-4 w-4" /> Import Leads</>}
        </button>
      )}

      {result && (
        <div className="mt-4 bg-emerald-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-800">Import Complete</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg p-3 text-center border border-emerald-100">
              <p className="text-2xl font-semibold text-emerald-600 tabular-nums">{result.inserted}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Imported</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center border border-zinc-100">
              <p className="text-2xl font-semibold text-zinc-400 tabular-nums">{result.duplicates}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Duplicates</p>
            </div>
          </div>
          {result.invalid > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600">
              <AlertCircle className="h-3.5 w-3.5" />
              {result.invalid} rows skipped (no valid LinkedIn URL)
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
