import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qdjmxoaxxgdpxgtpbaqt.supabase.co';
const supabaseKey = 'sb_publishable_q47gD-GrwsLfWh-yxD9kSA_uvZamJrZ';

export const supabase = createClient(supabaseUrl, supabaseKey);
