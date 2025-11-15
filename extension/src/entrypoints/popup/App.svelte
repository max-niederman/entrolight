<script lang="ts">
  import { onMount } from "svelte";
  import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../../lib/settings";

  let backendEndpoint = DEFAULT_SETTINGS.backendEndpoint;
  let surpriseQuantileInput = DEFAULT_SETTINGS.surpriseQuantile.toString();
  let initialized = false;
  let status: "idle" | "saving" | "saved" | "error" = "idle";
  let errorMessage = "";
  let resetHandle: number | null = null;

  onMount(async () => {
    const current = await loadSettings();
    backendEndpoint = current.backendEndpoint;
    surpriseQuantileInput = current.surpriseQuantile.toString();
    initialized = true;
  });

  function handleBackendInput(event: Event) {
    backendEndpoint = (event.currentTarget as HTMLInputElement).value;
    resetFeedback();
  }

  function handleQuantileInput(event: Event) {
    surpriseQuantileInput = (event.currentTarget as HTMLInputElement).value;
    resetFeedback();
  }

  async function handleSubmit() {
    status = "saving";
    errorMessage = "";
    if (resetHandle !== null) {
      window.clearTimeout(resetHandle);
      resetHandle = null;
    }
    try {
      const parsedQuantile = parseFloat(surpriseQuantileInput);
      const saved = await saveSettings({
        backendEndpoint,
        surpriseQuantile: parsedQuantile,
      });
      backendEndpoint = saved.backendEndpoint;
      surpriseQuantileInput = saved.surpriseQuantile.toString();
      status = "saved";
      resetHandle = window.setTimeout(() => {
        status = "idle";
        resetHandle = null;
      }, 1800);
    } catch (error) {
      status = "error";
      errorMessage = error instanceof Error ? error.message : "Unable to save settings";
    }
  }

  function resetFeedback() {
    if (status === "saved" || status === "error") {
      status = "idle";
      errorMessage = "";
    }
    if (resetHandle !== null) {
      window.clearTimeout(resetHandle);
      resetHandle = null;
    }
  }
</script>

<main>
  <header>
    <h1>Entrolight</h1>
    <p>Control how much context we send to the backend and how many surprises we highlight.</p>
  </header>

  {#if !initialized}
    <p class="status">Loading settings…</p>
  {:else}
    <form on:submit|preventDefault={handleSubmit}>
      <label for="backend-endpoint">
        <span class="label-heading">Backend endpoint</span>
        <input
          id="backend-endpoint"
          type="url"
          name="backend-endpoint"
          required
          spellcheck="false"
          value={backendEndpoint}
          on:input={handleBackendInput}
          placeholder="http://localhost:8000/api/v1/infer"
        />
        <small>Markdown chunks are POSTed to this FastAPI endpoint.</small>
      </label>

      <label for="surprise-quantile">
        <span class="label-heading">Surprise quantile</span>
        <input
          id="surprise-quantile"
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={surpriseQuantileInput}
          on:input={handleQuantileInput}
        />
        <small>Higher values mean only the top percentile of logprob surprises get highlighted.</small>
      </label>

      <button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save settings"}
      </button>

      {#if status === "saved"}
        <p class="status success">Settings saved.</p>
      {:else if status === "error"}
        <p class="status error">
          Unable to save settings{#if errorMessage}: {errorMessage}{/if}
        </p>
      {/if}
    </form>
  {/if}
</main>
