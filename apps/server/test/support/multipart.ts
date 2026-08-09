const BOUNDARY = '----tablinumTestBoundary7f3a';

export interface MultipartUpload {
  fields?: Record<string, string>;
  filename?: string;
  contentType?: string;
  data?: Buffer;
  /** Field name of the file part. */
  fileField?: string;
}

/** Build a multipart/form-data body by hand so tests need no browser FormData. */
export function multipart(upload: MultipartUpload): {
  headers: Record<string, string>;
  payload: Buffer;
} {
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(upload.fields ?? {})) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  if (upload.data !== undefined) {
    const field = upload.fileField ?? 'file';
    const filename = upload.filename ?? 'upload.bin';
    const type = upload.contentType ?? 'application/octet-stream';
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
          `Content-Type: ${type}\r\n\r\n`,
      ),
      upload.data,
      Buffer.from('\r\n'),
    );
  }

  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));

  return {
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat(chunks),
  };
}
