import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/messages - Get conversations and messages
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const conversationId = req.query.conversation_id;
    
    if (conversationId) {
      // Get messages for a specific conversation
      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      
      return res.json({ messages: messages || [] });
    } else {
      // Get all conversations for user
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select(`
          *,
          farm:farm_id (
            id,
            farm_name,
            farm_type
          ),
          graduate:graduate_id (
            id,
            full_name,
            qualification
          ),
          job:job_id (
            id,
            title
          ),
          messages:messages (
            id,
            content,
            sender_id,
            read,
            created_at
          )
        `)
        .or(`farm_id.eq.${req.user.id},graduate_id.eq.${req.user.id}`)
        .order('last_message_at', { ascending: false });
      
      if (error) throw error;
      
      return res.json({ conversations: conversations || [] });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/messages - Send a message
router.post('/', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { conversation_id, recipient_id, job_id, content } = req.body;
    
    if (!content) {
      return res.status(400).json({
        error: 'Message content is required'
      });
    }
    
    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    let conversationId = conversation_id;
    
    // Create conversation if it doesn't exist
    if (!conversationId) {
      if (!recipient_id || !job_id) {
        return res.status(400).json({
          error: 'recipient_id and job_id required for new conversation'
        });
      }
      
      const farmId = profile.role === 'farm' ? req.user.id : recipient_id;
      const graduateId = profile.role === 'farm' ? recipient_id : req.user.id;
      
      // Check if conversation already exists
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('farm_id', farmId)
        .eq('graduate_id', graduateId)
        .eq('job_id', job_id)
        .single();
      
      if (existing) {
        conversationId = existing.id;
      } else {
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            farm_id: farmId,
            graduate_id: graduateId,
            job_id: job_id
          })
          .select()
          .single();
        
        if (convError) throw convError;
        conversationId = newConversation.id;
      }
    }
    
    // Send message
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: req.user.id,
        content
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Update conversation last_message_at
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
    
    // Create notification for recipient
    const { data: conversation } = await supabase
      .from('conversations')
      .select('farm_id, graduate_id')
      .eq('id', conversationId)
      .single();
    
    const recipientId = conversation?.farm_id === req.user.id 
      ? conversation.graduate_id 
      : conversation?.farm_id;
    
    if (recipientId) {
      await supabase
        .from('notifications')
        .insert({
          user_id: recipientId,
          type: 'application_received',
          title: 'New Message',
          message: `You have a new message from ${profile.role === 'farm' ? 'a farm' : 'a graduate'}`,
          link: `/dashboard/messages/${conversationId}`
        });
    }
    
    return res.status(201).json({ message });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
