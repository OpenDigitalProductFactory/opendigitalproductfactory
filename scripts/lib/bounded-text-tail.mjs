export class BoundedTextTail {
  constructor(maxChars = 64 * 1024) {
    this.maxChars = Math.max(1, maxChars);
    this.value = "";
  }

  append(chunk) {
    this.value += String(chunk ?? "");
    if (this.value.length > this.maxChars) {
      this.value = this.value.slice(-this.maxChars);
    }
  }

  toString() {
    return this.value;
  }
}
