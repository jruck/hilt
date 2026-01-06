#!/usr/bin/env python3
"""
Fetch YouTube transcript and output as JSON.
Usage: python youtube-transcript.py VIDEO_ID_OR_URL
"""

import sys
import json
import re

from youtube_transcript_api import YouTubeTranscriptApi


def extract_video_id(input_str: str) -> str | None:
    """Extract video ID from URL or return as-is if already an ID."""
    # Direct video ID (11 characters)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', input_str.strip()):
        return input_str.strip()

    # YouTube URL patterns
    patterns = [
        r'(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})',
        r'(?:youtu\.be\/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})',
    ]

    for pattern in patterns:
        match = re.search(pattern, input_str)
        if match:
            return match.group(1)

    return None


def format_time(seconds: float) -> str:
    """Format seconds as mm:ss."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}:{secs:02d}"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Video ID or URL required"}))
        sys.exit(1)

    input_str = sys.argv[1]
    video_id = extract_video_id(input_str)

    if not video_id:
        print(json.dumps({"error": "Could not extract video ID from input"}))
        sys.exit(1)

    try:
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id)

        segments = []
        for snippet in transcript:
            segments.append({
                "time": format_time(snippet.start),
                "start": snippet.start,
                "duration": snippet.duration,
                "text": snippet.text
            })

        # Join all text for full transcript
        full_text = " ".join(s["text"] for s in segments)

        result = {
            "videoId": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "language": transcript.language_code if hasattr(transcript, 'language_code') else "en",
            "transcript": full_text,
            "segments": segments,
            "segmentCount": len(segments)
        }

        print(json.dumps(result))

    except Exception as e:
        error_msg = str(e)
        if "disabled" in error_msg.lower():
            print(json.dumps({"error": "Transcript is disabled for this video", "videoId": video_id}))
        elif "not found" in error_msg.lower() or "unavailable" in error_msg.lower():
            print(json.dumps({"error": "Video not found or unavailable", "videoId": video_id}))
        else:
            print(json.dumps({"error": f"Failed to fetch transcript: {error_msg}", "videoId": video_id}))
        sys.exit(1)


if __name__ == "__main__":
    main()
