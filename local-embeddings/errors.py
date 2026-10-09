"""Sanitized client-visible error codes."""

CLIENT_ERROR_CODES = frozenset(
    {
        "IDENTITY_MISMATCH",
        "INVALID_PURPOSE",
        "INVALID_BATCH",
        "INVALID_TEXT",
        "TEXT_TOO_LONG",
        "TOKEN_BUDGET_EXCEEDED",
        "INVALID_VECTOR_DIM",
        "INVALID_VECTOR_VALUE",
        "INVALID_VECTOR_NORM",
    }
)

HTTP_ERROR_CODES = frozenset(
    {
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "INVALID_JSON",
        "INVALID_SCHEMA",
        "INVALID_CONTENT_LENGTH",
        "BODY_TOO_LARGE",
        "BUSY",
        "NOT_READY",
        "INTERNAL",
        "REQUEST_TIMEOUT",
        "BAD_REQUEST",
    }
)


def client_error_from_value_error(exc: ValueError) -> tuple[str, int]:
    code = str(exc)
    if code in CLIENT_ERROR_CODES:
        return code, 400
    return "INTERNAL", 500
