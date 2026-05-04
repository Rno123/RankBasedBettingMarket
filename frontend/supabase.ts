console.log('ENV CHECK:', {
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
})
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const anonKey = process.env.SUPABASE_ANON_KEY!

if (!supabaseUrl || !anonKey) {
  throw new Error('Missing Supabase public env vars')
}

export const supabase = createClient(supabaseUrl, anonKey)
