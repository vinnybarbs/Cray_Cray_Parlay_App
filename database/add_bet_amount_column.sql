-- Add bet_amount column to parlays table to track unit size
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS bet_amount DECIMAL(10,2) DEFAULT 100.00;

-- Update existing parlays to have default bet amount of $100 
UPDATE parlays SET bet_amount = 100.00 WHERE bet_amount IS NULL;

-- Make the column NOT NULL with a default
ALTER TABLE parlays ALTER COLUMN bet_amount SET DEFAULT 100.00;
ALTER TABLE parlays ALTER COLUMN bet_amount SET NOT NULL;