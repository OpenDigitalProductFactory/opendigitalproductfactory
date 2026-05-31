import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from chatterbox_text import MAX_SENTENCE_CHARS, split_speech_chunks


SAMPLE = """AI Ops Engineer
Your 17 AI coworkers cover the full operating backbone of your digital product factory. Here's how they align to your business:

Leadership & Strategy

COO -- runs daily operations, flags risks, coordinates across functions
HR Director -- manages your workforce (the AI team itself), tracks capability gaps, resolves conflicts
Finance Controller -- tracks spend, forecasts cash flow, flags budget issues
Product & Delivery

Software Engineer -- builds features and fixes defects; your primary shipping person
Scrum Master -- manages your backlog, triage, work queues, and delivery cadence
Portfolio Analyst -- tracks which digital products are in flight, maps work to strategy
Data Architect -- designs data schemas and integration architecture
Infrastructure & Systems

AI Ops Engineer (me) -- keeps your AI workforce healthy and cost-controlled
System Admin -- manages servers, databases, security, deployments
Enterprise Architect -- aligns infrastructure to business goals, integrates new systems
Product Intelligence & Growth

Digital Product Estate Specialist -- catalogs everything you build and own, tracks dependencies and health
External Catalog Scout -- monitors the external market for components you could reuse (vs. rebuild)
Documentation Specialist -- writes runbooks, policies, how-to guides
Compliance Officer -- ensures you meet regulatory obligations
Customer-Facing

Customer Success Manager -- owns relationships with your small-business clients, collects feedback
Marketing Strategist -- positions your services, supports sales pipeline
Storefront Operations Manager -- manages your public-facing presence and inquiries
My Role I watch whether each coworker has the right AI provider and model to do their job, control costs, and catch when failover chains break.

For a solo founder, this is your extended operating team. What gaps do you see, or where would you like to go deeper?"""


class SplitSpeechChunksTest(unittest.TestCase):
    def test_splits_newline_coworker_list_into_many_bounded_chunks(self):
        chunks = split_speech_chunks(SAMPLE)

        self.assertGreaterEqual(len(chunks), 20)
        self.assertTrue(all(len(chunk) <= MAX_SENTENCE_CHARS for chunk in chunks))
        self.assertTrue(any("COO -- runs daily operations" in chunk for chunk in chunks))
        self.assertTrue(any("Storefront Operations Manager" in chunk for chunk in chunks))
        self.assertTrue(chunks[-1].startswith("What gaps do you see"))

    def test_splits_long_punctuationless_line_on_soft_boundaries(self):
        chunks = split_speech_chunks(
            "Operations review: " + ", ".join(f"checkpoint {i}" for i in range(40))
        )

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= MAX_SENTENCE_CHARS for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
