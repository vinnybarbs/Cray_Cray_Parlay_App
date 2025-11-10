#!/usr/bin/env node

/**
 * Add bet_amount column to parlays table
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function addBetAmountColumn() {
  try {
    console.log('🔄 Adding bet_amount column to parlays table...');
    
    // Add the column if it doesn't exist
    const { error: addColumnError } = await supabase.rpc('sql', {
      query: `
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'parlays' AND column_name = 'bet_amount'
          ) THEN
            ALTER TABLE parlays ADD COLUMN bet_amount DECIMAL(10,2) DEFAULT 100.00;
            RAISE NOTICE 'Added bet_amount column';
          ELSE
            RAISE NOTICE 'bet_amount column already exists';
          END IF;
        END
        $$;
      `
    });
    
    if (addColumnError) {
      console.log('Column addition result:', addColumnError);
    }
    
    // Update existing parlays to have default bet amount
    console.log('🔄 Setting default bet amounts for existing parlays...');
    
    const { data: updateData, error: updateError } = await supabase
      .from('parlays')
      .update({ bet_amount: 100.00 })
      .is('bet_amount', null)
      .select();
    
    if (updateError) {
      console.error('❌ Error updating existing parlays:', updateError);
    } else {
      console.log(`✅ Updated ${updateData?.length || 0} existing parlays with default bet amount`);
    }
    
    console.log('✅ Migration completed successfully');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

addBetAmountColumn();