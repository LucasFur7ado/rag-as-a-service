# Platform Runbook (fictional service)

This document describes an imaginary internal service. It exists so the
evaluation corpus contains operational prose with specific, checkable facts —
identifiers, thresholds, and procedures — rather than only conceptual writing.
Nothing here describes a real system.

## Service overview

Kestrel is the document intake service. It accepts uploads, extracts text,
schedules processing, and reports status. It is stateless and horizontally
scaled; all durable state lives in Postgres and object storage.

The service is owned by the Ingest team. Its on-call rotation is weekly, handing
over on Wednesdays at 10:00 UTC.

## Limits

Uploads are capped at 25 megabytes per file. Requests above the cap are rejected
with HTTP 413 before any bytes are written to storage, so an oversized upload
costs no storage and no processing time.

Accepted formats are PDF, plain text, and Markdown. A PDF with no text layer —
typically a scan — is rejected as a permanent failure rather than retried,
because no number of attempts will produce text that is not in the file.

Programmatic callers are limited to 60 requests per minute per API key by
default. The limit is enforced with a sliding window, so a caller cannot fire a
full quota at the end of one minute and another at the start of the next.
Rejected requests are not counted against the window, which means being
throttled never extends the penalty.

## Processing states

A document moves through four states: `uploaded`, `processing`, `ready`, and
`error`. Transitions are one-way apart from reprocessing, which returns a
document to `processing` from any terminal state.

A document that has been in `processing` for more than fifteen minutes is
presumed abandoned — its worker was evicted or timed out — and becomes eligible
for reprocessing. Before that window elapses, a reprocess request is refused
with HTTP 409, so two workers never race on the same document.

## Failure taxonomy

Failures are either transient or permanent, and the distinction drives the retry
logic. Transient failures — network timeouts, rate limits, upstream 5xx — are
retried three times with exponential backoff starting at two seconds.

Permanent failures skip retries entirely and mark the document failed
immediately. An unparseable file, a rejected credential, and a configuration
mismatch are all permanent: retrying them only burns the invocation's clock and
delays the error the operator needs to see.

## Common alerts

**IntakeBacklogGrowing** fires when documents in `processing` exceed 500 for ten
consecutive minutes. The usual cause is a slow upstream extraction dependency.
Check extraction latency first; if it is normal, the backlog is genuine and the
worker pool needs scaling.

**ExtractionErrorRate** fires when more than 5% of documents in a rolling hour
end in `error`. A sudden spike concentrated in one tenant almost always means
that tenant started uploading scanned PDFs, which is a support conversation
rather than an engineering incident.

**StorageWriteFailures** fires on any write failure to object storage. This one
pages immediately at any volume, because a failed write means the source file is
gone and the upload cannot be recovered by reprocessing.

## Escalation

Page the Ingest on-call first. If the incident involves object storage or the
database rather than Kestrel itself, escalate to the Platform team; they own
both dependencies and Kestrel has no ability to mitigate a fault in either.

Do not restart the worker pool to clear a backlog. Restarting drops in-flight
work back to `processing` with no progress recorded, which lengthens the backlog
it was meant to shorten.
