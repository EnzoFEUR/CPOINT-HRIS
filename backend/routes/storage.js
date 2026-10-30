import express from 'express';
import { supabase } from '../supabaseClient.js';
import { MEDIA_MAX_PATH_LENGTH, MEDIA_MAX_PATHS, resolveMediaUrls } from '../services/mediaStorageService.js';

export function createStorageRouter(client = supabase, { projectUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://lzqshktnrvtlattdiwxf.supabase.co' } = {}) {
    const router = express.Router();
    router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
    router.post('/media-urls', async (req, res) => {
        if (!req.user) return res.status(401).json({ success: false, error: 'AUTHENTICATION_REQUIRED' });
        const paths = req.body?.paths;
        if (!Array.isArray(paths) || paths.length > MEDIA_MAX_PATHS || paths.some(path => typeof path !== 'string' || path.length > MEDIA_MAX_PATH_LENGTH)) {
            return res.status(400).json({ success: false, error: 'INVALID_PATHS' });
        }
        const files = await resolveMediaUrls(client, req.user, paths, projectUrl);
        return res.json({ success: true, files });
    });
    return router;
}

export default createStorageRouter();
