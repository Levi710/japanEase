import unittest

from app.services.transcription.whisper_service import split_transcript_lines


class FakeWord:
    def __init__(self, start, end, word):
        self.start = start
        self.end = end
        self.word = word


class FakeSegment:
    def __init__(self, start, end, text, words):
        self.start = start
        self.end = end
        self.text = text
        self.words = words


class SplitTranscriptLinesTests(unittest.TestCase):
    def test_splits_one_whisper_segment_into_multiple_subtitle_lines(self):
        segment = FakeSegment(
            start=36.48,
            end=44.44,
            text="互いの砂時計 眺めながらキスをしようよ",
            words=[
                FakeWord(36.48, 37.58, "互"),
                FakeWord(37.58, 37.88, "い"),
                FakeWord(37.88, 38.10, "の"),
                FakeWord(38.10, 38.58, "砂"),
                FakeWord(38.58, 38.82, "時"),
                FakeWord(38.82, 39.94, "計"),
                FakeWord(41.30, 41.52, " 眺"),
                FakeWord(41.52, 41.76, "め"),
                FakeWord(41.76, 42.00, "な"),
                FakeWord(42.00, 42.18, "が"),
                FakeWord(42.18, 42.44, "ら"),
                FakeWord(42.44, 42.68, "キ"),
                FakeWord(42.68, 42.94, "ス"),
                FakeWord(42.94, 43.42, "を"),
                FakeWord(43.42, 43.74, "し"),
                FakeWord(43.74, 44.18, "よう"),
                FakeWord(44.18, 44.44, "よ"),
            ],
        )

        result = split_transcript_lines([segment])

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["text"], "互いの砂時計")
        self.assertEqual(result[1]["text"], "眺めながらキスをしようよ")
        self.assertAlmostEqual(result[0]["start"], 36.48)
        self.assertAlmostEqual(result[1]["start"], 41.30)

    def test_filters_empty_quote_only_segments(self):
        segment = FakeSegment(start=0.0, end=1.0, text=" '' ", words=[])

        result = split_transcript_lines([segment])

        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
