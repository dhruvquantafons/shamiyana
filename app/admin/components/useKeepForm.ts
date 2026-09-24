"use client";

import { startTransition } from "react";

/**
 * Submit handler that dispatches a form action without React 19's automatic
 * form reset, which otherwise clears every field when the action returns —
 * including when it returns a validation error the person needs to fix.
 */
export function keepFormOnSubmit(
  formAction: (fd: FormData) => void,
  confirmMessage?: string,
) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  };
}
