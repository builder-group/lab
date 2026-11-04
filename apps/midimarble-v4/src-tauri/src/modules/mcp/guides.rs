const GUIDES: [(&str, &str); 5] = [
    ("overview", include_str!("guides/overview.md")),
    ("building-a-track", include_str!("guides/building-a-track.md")),
    ("film-look", include_str!("guides/film-look.md")),
    ("assets", include_str!("guides/assets.md")),
    ("words", include_str!("guides/words.md")),
];

pub const TOPICS: [&str; 5] = ["overview", "building-a-track", "film-look", "assets", "words"];

/// A guide by topic, the overview without one
pub fn guide(topic: Option<&str>) -> Result<&'static str, String> {
    let topic = topic.unwrap_or("overview");
    return GUIDES
        .iter()
        .find(|(name, _)| *name == topic)
        .map(|(_, text)| *text)
        .ok_or_else(|| format!("No guide named {}. Topics: {}", topic, TOPICS.join(", ")));
}
