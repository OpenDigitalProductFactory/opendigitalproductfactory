DROP TRIGGER IF EXISTS trg_customer_contact_search ON "CustomerContact";
DROP TRIGGER IF EXISTS trg_customer_account_search ON "CustomerAccount";

DROP FUNCTION IF EXISTS customer_contact_search_update();
DROP FUNCTION IF EXISTS customer_account_search_update();
