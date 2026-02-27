'use client';

import { useState, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';

interface CSVUploaderProps {
  campaignId: string;
  onSuccess?: () => void;
}

export default function CSVUploader({ campaignId, onSuccess }: CSVUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    duplicates: number;
    invalid: number;
    total_rows: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith('.csv')) {
      setFile(dropped);
      setResult(null);
    } else {
      toast.error('Please upload a CSV file');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('campaign_id', campaignId);

      const { data } = await axios.post('/api/leads/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(data);
      toast.success(`Successfully imported ${data.inserted} leads!`);
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr?.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Upload className="h-4 w-4 text-blue-600" />
        Import Leads from CSV
      </h3>

      {/* Required columns info */}
      <div className="bg-blue-50 rounded-lg p-3 mb-4">
        <p className="text-xs text-blue-700 font-medium mb-1">Required column:</p>
        <code className="text-xs text-blue-600">linkedin_url</code>
        <p className="text-xs text-blue-500 mt-1">
          Optional: first_name, last_name, company, title, email, phone
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => document.getElementById('csv-input')?.click()}
      >
        <input
          id="csv-input"
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
        />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileText className="h-8 w-8 text-blue-600" />
            <div className="text-left">
              <p className="text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); }}
              className="ml-2 p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-4 w-4 text-gray-400" />
            </button>
          </div>
        ) : (
          <div>
            <Upload className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Drop your CSV here or <span className="text-blue-600">browse</span></p>
            <p className="text-xs text-gray-400 mt-1">Supports .csv files</p>
          </div>
        )}
      </div>

      {/* Upload button */}
      {file && !result && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="mt-4 w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</>
          ) : (
            <><Upload className="h-4 w-4" /> Import Leads</>
          )}
        </button>
      )}

      {/* Result */}
      {result && (
        <div className="mt-4 bg-green-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="font-semibold text-green-800">Import Complete</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{result.inserted}</p>
              <p className="text-xs text-gray-500">Imported</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-400">{result.duplicates}</p>
              <p className="text-xs text-gray-500">Duplicates</p>
            </div>
          </div>
          {result.invalid > 0 && (
            <div className="flex items-center gap-2 mt-2 text-xs text-orange-600">
              <AlertCircle className="h-3.5 w-3.5" />
              {result.invalid} rows skipped (no valid LinkedIn URL)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
