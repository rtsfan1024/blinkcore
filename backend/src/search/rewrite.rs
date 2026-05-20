/// jump_url 重写
///
/// 规则:
///   visibility == "public"                      → /articles/{slug}#{slug_anchor}
///   visibility == "private" && client_verify == "SUCCESS" → /articles/{slug}#{slug_anchor}
///   visibility == "private" && client_verify != "SUCCESS" → /lead-capture?target={slug}
///   _ → /articles/{slug}#{slug_anchor} (default)
pub fn rewrite_jump_url(
    slug: &str,
    slug_anchor: &str,
    visibility: &str,
    client_verify: &str,
) -> String {
    match visibility {
        "public" => format!("/articles/{}#{}", slug, slug_anchor),
        "private" if client_verify == "SUCCESS" => format!("/articles/{}#{}", slug, slug_anchor),
        "private" => format!("/lead-capture?target={}", slug),
        _ => format!("/articles/{}#{}", slug, slug_anchor),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jump_url_rewrite() {
        // Case 1: public → 直接跳转
        assert_eq!(
            rewrite_jump_url("my-post", "intro", "public", ""),
            "/articles/my-post#intro"
        );
        assert_eq!(
            rewrite_jump_url("my-post", "intro", "public", "SUCCESS"),
            "/articles/my-post#intro"
        );

        // Case 2: private + SUCCESS → 直接跳转
        assert_eq!(
            rewrite_jump_url("private-doc", "sec1", "private", "SUCCESS"),
            "/articles/private-doc#sec1"
        );

        // Case 3: private + 非 SUCCESS → lead-capture
        assert_eq!(
            rewrite_jump_url("private-doc", "sec1", "private", "FAILURE"),
            "/lead-capture?target=private-doc"
        );
        assert_eq!(
            rewrite_jump_url("private-doc", "sec1", "private", ""),
            "/lead-capture?target=private-doc"
        );

        // Case 4: 未知 visibility → 默认直接跳转
        assert_eq!(
            rewrite_jump_url("doc", "anchor", "draft", "anything"),
            "/articles/doc#anchor"
        );
    }
}