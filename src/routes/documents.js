// Documents routes - for managing multiple documents per user
import express from 'express';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/documents - Get all documents for the authenticated user
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { document_type } = req.query;
    
    let query = supabase
      .from('documents')
      .select('*')
      .eq('user_id', req.user.id)
      .order('uploaded_at', { ascending: false });
    
    if (document_type) {
      query = query.eq('document_type', document_type);
    }
    
    const { data: documents, error } = await query;
    
    if (error) throw error;
    
    return res.json({ documents: documents || [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/documents - Upload a new document
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { uploadSingle } = await import('../middleware/upload.js');
    
    // Apply multer middleware
    uploadSingle('file')(req, res, next);
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to process upload'
    });
  }
}, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { uploadToR2 } = await import('../services/r2-service.js');
    const { document_type, description } = req.body;
    
    if (!['certificate', 'transcript', 'cv', 'nss_letter'].includes(document_type)) {
      return res.status(400).json({
        error: 'Invalid document type. Must be certificate, transcript, cv, or nss_letter'
      });
    }

    // Generate unique filename
    const fileExt = req.file.originalname.split('.').pop();
    const fileName = `${req.user.id}/documents/${document_type}_${Date.now()}.${fileExt}`;

    // Upload to R2
    const publicUrl = await uploadToR2(
      req.file.buffer,
      fileName,
      req.file.mimetype
    );

    // Insert document record using admin client to bypass RLS
    const { data: document, error: insertError } = await supabaseAdmin
      .from('documents')
      .insert({
        user_id: req.user.id,
        document_type,
        file_name: req.file.originalname,
        file_url: publicUrl,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({
      document,
      message: 'Document uploaded successfully'
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to upload document'
    });
  }
});

// DELETE /api/documents/:id - Delete a document
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Get document to verify ownership
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    
    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from R2
    try {
      const { deleteFromR2 } = await import('../services/r2-service.js');
      // Extract file path from URL
      const urlParts = document.file_url.split('/');
      const fileName = urlParts.slice(urlParts.indexOf('documents') - 1).join('/');
      await deleteFromR2(fileName);
    } catch (r2Error) {
      console.warn('Failed to delete from R2:', r2Error);
      // Continue with database deletion even if R2 deletion fails
    }

    // Delete from database using admin client
    const { error: deleteError } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) throw deleteError;

    return res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to delete document'
    });
  }
});

export default router;
