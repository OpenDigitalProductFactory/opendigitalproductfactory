// scripts/harness/scenarios/restaurant.mjs (draft — BI-41D8DF5F)
// Restaurant scenario pack: menu, guest personas, one dinner-service demand wave.

export default {
  archetypeId: "restaurant",
  orgSlug: "digital-product-factory",
  identity: { tagline: "Neighbourhood trattoria — wood-fired, seasonal, local" },
  catalog: [
    { name: "Margherita Pizza", description: "San Marzano tomato, fresh mozzarella, basil", category: "Mains", ctaType: "purchase", priceType: "fixed", priceAmount: 16, ctaLabel: "Order" },
    { name: "Spaghetti Carbonara", description: "Guanciale, pecorino, egg yolk", category: "Mains", ctaType: "purchase", priceType: "fixed", priceAmount: 18, ctaLabel: "Order" },
    { name: "Grilled Salmon", description: "Atlantic salmon, lemon butter, seasonal vegetables", category: "Mains", ctaType: "purchase", priceType: "fixed", priceAmount: 26, ctaLabel: "Order" },
    { name: "Ribeye Steak", description: "12oz ribeye, herb butter, fries", category: "Mains", ctaType: "purchase", priceType: "fixed", priceAmount: 34, ctaLabel: "Order" },
    { name: "Caesar Salad", description: "Romaine, parmesan, house-made croutons", category: "Starters", ctaType: "purchase", priceType: "fixed", priceAmount: 11, ctaLabel: "Order" },
    { name: "Bruschetta", description: "Grilled sourdough, tomato, garlic, basil", category: "Starters", ctaType: "purchase", priceType: "fixed", priceAmount: 9, ctaLabel: "Order" },
    { name: "Tiramisu", description: "Classic mascarpone, espresso, cocoa", category: "Desserts", ctaType: "purchase", priceType: "fixed", priceAmount: 10, ctaLabel: "Order" },
    { name: "Panna Cotta", description: "Vanilla bean, berry coulis", category: "Desserts", ctaType: "purchase", priceType: "fixed", priceAmount: 9, ctaLabel: "Order" },
  ],
  personas: {
    quinn: { name: "Quinn Doyle", email: "quinn-doyle-6@example.com", address: { line1: "12 Harbor Lane", city: "Springfield", postcode: "62701" } },
    iris: { name: "Iris Owens", email: "iris-owens-1@example.com", address: { line1: "44 Elm Street", city: "Springfield", postcode: "62702" } },
    chloe: { name: "Chloe Haynes", email: "chloe-haynes-0@example.com", address: { line1: "7 Maple Ave", city: "Springfield", postcode: "62703" } },
    vik: { name: "Vik Frost", email: "vik-frost-3@example.com", address: { line1: "221 Birch Road", city: "Springfield", postcode: "62704" } },
    devan: { name: "Devan Mensah", email: "devan-mensah-4@example.com", address: { line1: "90 Cedar Court", city: "Springfield", postcode: "62705" } },
    wren: { name: "Wren Khan", email: "wren-khan-7@example.com", address: { line1: "5 Oak Terrace", city: "Springfield", postcode: "62706" } },
  },
  get demand() {
    const p = this.personas;
    // A dinner-service wave weighted so one dish (Margherita) is the clear
    // best-seller — the demand signal the proactive-restocking loop needs.
    return [
      { kind: "order", item: "Margherita Pizza", persona: p.quinn, qty: 2 },
      { kind: "order", item: "Spaghetti Carbonara", persona: p.iris, qty: 1 },
      { kind: "order", item: "Margherita Pizza", persona: p.chloe, qty: 3 },
      { kind: "order", item: "Grilled Salmon", persona: p.vik, qty: 2 },
      { kind: "order", item: "Margherita Pizza", persona: p.devan, qty: 2 },
      { kind: "order", item: "Ribeye Steak", persona: p.wren, qty: 1 },
      { kind: "order", item: "Margherita Pizza", persona: p.iris, qty: 4 },
      { kind: "order", item: "Tiramisu", persona: p.vik, qty: 2 },
    ];
  },
  stubs: {
    // Card payment: storefront orders are order-then-settle today, so no card
    // rail is needed at order time. When checkout gains a payment step, stub it
    // here (test card token) rather than in product code.
    cardPayment: "not-required-at-order-time",
    // Supplier ordering: blocked on ingredient substrate (BI-SPEND-003).
    supplierOrdering: "pending-ingredient-substrate",
  },
};
