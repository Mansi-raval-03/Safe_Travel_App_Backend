/*
  Edge Function: send_sos_notification
  - Expects body { sosId: <uuid> }
  - Loads sos_event row and receiver device token (from profiles.device_token)
  - Sends FCM using Firebase Admin SDK
  - Requires environment secrets:
      FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON)
      SUPABASE_URL
      SUPABASE_SERVICE_ROLE_KEY
*/

import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT_JSON env var');
}

let serviceAccount = {};
try {
  serviceAccount = serviceAccountJson ? JSON.parse(serviceAccountJson) : {};
} catch (e) {
  console.error('Invalid service account JSON', e);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  try {
    const body = await req.json();
    const sosId = body.sosId || body.id;
    if (!sosId) return res.status(400).json({ error: 'sosId required' });

    // Fetch sos event with sender/receiver info
    const { data: sosRow, error: sosErr } = await supabase
      .from('sos_events')
      .select('id, message, latitude, longitude, created_at, sender_id, receiver_id')
      .eq('id', sosId)
      .limit(1)
      .single();

    if (sosErr || !sosRow) {
      console.error('sos event not found', sosErr);
      return res.status(404).json({ error: 'sos event not found' });
    }

    // Fetch sender and receiver profiles for names and device token
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('full_name, device_token, phone')
      .eq('id', sosRow.sender_id)
      .limit(1)
      .single();

    const { data: receiverProfile } = await supabase
      .from('profiles')
      .select('full_name, device_token')
      .eq('id', sosRow.receiver_id)
      .limit(1)
      .single();

    const token = receiverProfile?.device_token;
    if (!token) {
      console.warn('Receiver has no device token');
      return res.status(200).json({ ok: false, warning: 'missing token' });
    }

    const payload = {
      token,
      notification: {
        title: `${senderProfile?.full_name ?? 'SOS Alert'}`,
        body: sosRow.message ?? 'Emergency alert',
      },
      data: {
        sosId: sosRow.id,
        senderId: String(sosRow.sender_id),
        senderName: senderProfile?.full_name ?? '',
        message: sosRow.message ?? '',
        latitude: String(sosRow.latitude),
        longitude: String(sosRow.longitude),
        timestamp: String(Date.now()),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'sos_alerts',
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            'content-available': 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(payload);
    console.log('FCM sent:', response);
    return res.status(200).json({ ok: true, messageId: response });
  } catch (err) {
    console.error('Edge function error', err);
    return res.status(500).json({ error: String(err) });
  }
}
