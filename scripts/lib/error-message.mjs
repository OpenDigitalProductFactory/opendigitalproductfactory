// Scripts-runtime counterpart of apps/web/lib/shared/get-error-message.ts:
// "unknown thrown value -> human string" for shared modules that run outside the
// web bundle (the promoter-image source writer, BI-224F56F1). Keep the two in
// step; the web helper also ships to browser components, which do not import
// scripts/lib.

export function getErrorMessage(err) {
    if (err instanceof Error)
        return err.message;
    if (typeof err === "string")
        return err;
    // Some thrown values (e.g. Response-like or plain objects) carry a `message`.
    if (err && typeof err === "object" && "message" in err) {
        const m = err.message;
        if (typeof m === "string")
            return m;
    }
    try {
        return String(err);
    }
    catch {
        return "Unknown error";
    }
}
