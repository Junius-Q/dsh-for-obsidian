name: Pull Request
description: Submit changes to dsh for Obsidian
labels: []
body:
  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: What does this change do, and why?
    validations:
      required: true
  - type: checkboxes
    id: checks
    attributes:
      label: Checklist
      options:
        - label: `npm run build` passes (type-check + production bundle)
          required: true
        - label: Changes are focused and commit messages are clear
          required: true
        - label: README / CHANGELOG updated if usage or setup changed
          required: false
        - label: UI strings added to both `en` and `zh` in `src/i18n.ts`
          required: false
