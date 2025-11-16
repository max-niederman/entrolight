<script lang="ts">
  import { onMount } from "svelte";
  import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../../lib/settings";

  let fireworksApiKey = DEFAULT_SETTINGS.fireworksApiKey;
  let fireworksModel = DEFAULT_SETTINGS.fireworksModel;
  let surpriseQuantileInput = DEFAULT_SETTINGS.surpriseQuantile.toString();
  let initialized = false;
  let status: "idle" | "saving" | "saved" | "error" = "idle";
  let errorMessage = "";
  let resetHandle: number | null = null;

  onMount(async () => {
    const current = await loadSettings();
    fireworksApiKey = current.fireworksApiKey;
    fireworksModel = current.fireworksModel;
    surpriseQuantileInput = current.surpriseQuantile.toString();
    initialized = true;
  });

  function handleApiKeyInput(event: Event) {
    fireworksApiKey = (event.currentTarget as HTMLInputElement).value;
    resetFeedback();
  }

  function handleModelInput(event: Event) {
    fireworksModel = (event.currentTarget as HTMLInputElement).value;
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
        fireworksApiKey,
        fireworksModel,
        surpriseQuantile: parsedQuantile,
      });
      fireworksApiKey = saved.fireworksApiKey;
      fireworksModel = saved.fireworksModel;
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
    <p>Configure Fireworks access plus the surprise threshold used when highlighting text.</p>
  </header>

  {#if !initialized}
    <p class="status">Loading settings…</p>
  {:else}
    <form on:submit|preventDefault={handleSubmit}>
      <label for="fireworks-api-key">
        <span class="label-heading">Fireworks API key</span>
        <input
          id="fireworks-api-key"
          type="password"
          name="fireworks-api-key"
          autocomplete="off"
          spellcheck="false"
          value={fireworksApiKey}
          on:input={handleApiKeyInput}
          placeholder="sk_fireworks_..."
        />
        <small>Used to authenticate calls to Fireworks' serverless inference API.</small>
      </label>

      <label for="fireworks-model">
        <span class="label-heading">Fireworks model code</span>
        <input
          id="fireworks-model"
          type="text"
          name="fireworks-model"
          required
          spellcheck="false"
          value={fireworksModel}
          on:input={handleModelInput}
          placeholder="accounts/fireworks/models/llama-v3p1-8b-instruct"
        />
        <small>Serverless model identifier passed to Fireworks in each inference request.</small>
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
