const options = process.env.NODE_OPTIONS || "";
const expected = [
  "--trace-warnings",
  "--max-old-space-size=8192",
];

process.exit(expected.every((option) => options.includes(option)) ? 0 : 1);
