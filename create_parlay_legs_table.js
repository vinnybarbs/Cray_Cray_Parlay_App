require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const schema = `
-- Create parlay_legs table
create table if not exists parlay_legs (
  id uuid primary key default gen_random_uuid(),
  parlay_id uuid not null references parlays(id) on delete cascade,
  leg_number integer not null,
  game_date date not null,
  sport varchar(50) not null,
  home_team varchar(100) not null,
  away_team varchar(100) not null,
  bet_type varchar(50) not null,
  bet_details jsonb not null,
  odds varchar(20) not null,
  confidence integer,
  reasoning text,
  game_completed boolean default false,
  leg_result varchar(20),
  actual_value numeric(10,2),
  margin_of_victory numeric(10,2),
  created_at timestamptz default now(),
  resolved_at timestamptz,
  pick_description text,
  pick varchar(200),
  outcome varchar(20),
  settled_at timestamptz
);

-- Create indexes
create index if not exists idx_parlay_legs_parlay on parlay_legs(parlay_id);
create index if not exists idx_parlay_legs_game_date on parlay_legs(game_date);
create index if not exists idx_parlay_legs_teams on parlay_legs(home_team, away_team);
create index if not exists idx_parlay_legs_bet_type on parlay_legs(bet_type);

-- Enable RLS
alter table parlay_legs enable row level security;

-- Drop existing policies if they exist
drop policy if exists parlay_legs_select on parlay_legs;
drop policy if exists parlay_legs_insert on parlay_legs;
drop policy if exists parlay_legs_update on parlay_legs;
drop policy if exists parlay_legs_delete on parlay_legs;

-- Create RLS policies
create policy parlay_legs_select on parlay_legs for select using (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);

create policy parlay_legs_insert on parlay_legs for insert with check (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);

create policy parlay_legs_update on parlay_legs for update using (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);

create policy parlay_legs_delete on parlay_legs for delete using (
  exists (
    select 1 from parlays p where p.id = parlay_id and p.user_id = auth.uid()
  )
);
`;

async function createTable() {
  console.log('\n🏗️  CREATING PARLAY_LEGS TABLE\n');
  
  // Execute the SQL using a raw query
  const { data, error } = await supabase.rpc('exec_sql', { query: schema });
  
  if (error) {
    console.log('⚠️  RPC method not available, trying direct approach...\n');
    
    // Alternative: Use a simple node-postgres connection
    const pg = require('pg');
    const { Pool } = pg;
    
    // Extract connection details from Supabase URL
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    // Need direct database URL - this won't work with Supabase REST API
    console.log('❌ Cannot execute raw SQL through Supabase client.');
    console.log('\n📋 SOLUTION: Run this SQL manually in Supabase SQL Editor:\n');
    console.log('─'.repeat(80));
    console.log(schema);
    console.log('─'.repeat(80));
    console.log('\nSteps:');
    console.log('1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql');
    console.log('2. Copy the SQL above');
    console.log('3. Paste and click "Run"');
    console.log('4. Run: node check_parlay_legs_detail.js to verify');
    return;
  }
  
  console.log('✅ Table created successfully!');
  
  // Verify
  const { data: testData, error: testError } = await supabase
    .from('parlay_legs')
    .select('*')
    .limit(1);
    
  if (testError) {
    console.log('❌ Verification failed:', testError.message);
  } else {
    console.log('✅ Verified: parlay_legs table is accessible!');
  }
}

createTable().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
