import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { InvoiceRecord, PaymentRecord, JobStatusResponse } from '../types/Document';
import { documentService } from '../services/documentService';
import { extractErrorMessage } from '../../../utils/errorUtils';

export type UploadProgressStatus =
  | 'idle'
  | 'uploading'
  | 'polling'
  | 'extracted'
  | 'saving'
  | 'saved'
  | 'failed';

export interface UploadProgressState {
  status:          UploadProgressStatus;
  jobId:           string | null;
  documentId:      number | null;
  fileName:        string | null;
  // documentType is now set from the backend job response, not from user input
  documentType:    'INVOICE' | 'PAYMENT' | null;
  previewRows:     (InvoiceRecord | PaymentRecord)[];
  error:           string | null;
  savedCount:      number | null;
  reviewRequested: boolean;
}

const initialState: UploadProgressState = {
  status:          'idle',
  jobId:           null,
  documentId:      null,
  fileName:        null,
  documentType:    null,
  previewRows:     [],
  error:           null,
  savedCount:      null,
  reviewRequested: false,
};

export const startPollingThunk = createAsyncThunk(
  'uploadProgress/startPolling',
  async ({ jobId }: { jobId: string }, { rejectWithValue }) => {
    try {
      return await documentService.pollJobStatus(jobId);
    } catch (err) {
      return rejectWithValue(extractErrorMessage(err));
    }
  }
);

export const saveProgressRecordsThunk = createAsyncThunk(
  'uploadProgress/save',
  async (
    { documentId, documentType, records }: {
      documentId: number;
      documentType: 'INVOICE' | 'PAYMENT';
      records: (InvoiceRecord | PaymentRecord)[];
    },
    { rejectWithValue }
  ) => {
    try {
      return await documentService.saveRecords(documentId, documentType, records);
    } catch (err) {
      return rejectWithValue(extractErrorMessage(err));
    }
  }
);

const uploadProgressSlice = createSlice({
  name: 'uploadProgress',
  initialState,
  reducers: {
    // documentType removed from uploadStarted — we don't know it yet
    uploadStarted(state, action: PayloadAction<{
      jobId: string;
      documentId: number;
      fileName: string;
    }>) {
      state.status       = 'uploading';
      state.jobId        = action.payload.jobId;
      state.documentId   = action.payload.documentId;
      state.fileName     = action.payload.fileName;
      state.documentType = null;   // will be set once extraction is done
      state.previewRows  = [];
      state.error        = null;
      state.savedCount   = null;
    },

    pollingStarted(state) {
      state.status = 'polling';
      state.error  = null;
    },

    // documentType now comes from the job status response
    extractionDone(state, action: PayloadAction<{
      rows: (InvoiceRecord | PaymentRecord)[];
      documentType: 'INVOICE' | 'PAYMENT';
    }>) {
      state.status       = 'extracted';
      state.previewRows  = action.payload.rows;
      state.documentType = action.payload.documentType;
    },

    savingStarted(state) {
      state.status = 'saving';
      state.error  = null;
    },

    saveDone(state, action: PayloadAction<number>) {
      state.status     = 'saved';
      state.savedCount = action.payload;
    },

    uploadFailed(state, action: PayloadAction<string>) {
      state.status = 'failed';
      state.error  = action.payload;
    },

    requestReview(state) {
      state.reviewRequested = true;
    },

    clearReviewRequest(state) {
      state.reviewRequested = false;
    },

    updatePreviewRows(state, action: PayloadAction<(InvoiceRecord | PaymentRecord)[]>) {
      state.previewRows = action.payload;
    },

    reset: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(startPollingThunk.pending, (state) => {
        state.status = 'polling';
        state.error  = null;
      })
      .addCase(startPollingThunk.fulfilled, (state, action: PayloadAction<JobStatusResponse>) => {
        state.status       = 'extracted';
        state.previewRows  = action.payload.preview_data ?? [];
        state.documentType = action.payload.document_type ?? null;
      })
      .addCase(startPollingThunk.rejected, (state, action) => {
        state.status = 'failed';
        state.error  = action.payload as string;
      });
    builder
      .addCase(saveProgressRecordsThunk.pending, (state) => {
        state.status = 'saving';
        state.error  = null;
      })
      .addCase(saveProgressRecordsThunk.fulfilled, (state, action) => {
        state.status     = 'saved';
        state.savedCount = action.payload.records_saved;
      })
      .addCase(saveProgressRecordsThunk.rejected, (state, action) => {
        state.status = 'failed';
        state.error  = action.payload as string;
      });
  },
});

export const {
  uploadStarted,
  pollingStarted,
  extractionDone,
  savingStarted,
  saveDone,
  uploadFailed,
  requestReview,
  clearReviewRequest,
  updatePreviewRows,
  reset,
} = uploadProgressSlice.actions;
export default uploadProgressSlice.reducer;