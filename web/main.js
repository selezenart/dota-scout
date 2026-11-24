import '@fontsource-variable/inter';
// Keep the invitation walkthrough entirely separate from live accounts and drafts.
if (new URLSearchParams(location.search).has('onboarding-demo')) {
  import('./onboarding-demo.js');
} else {
  import('./app.js');
}
