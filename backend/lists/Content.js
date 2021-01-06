const {
  Text,
  Checkbox,
  Slug,
  Url,
  Float,
  Integer,
} = require('@keystonejs/fields');
const { Markdown } = require('@keystonejs/fields-markdown');
const slugify = require('slugify');

module.exports = {
  fields: {
    title: {
      type: Text,
      isRequired: true,
    },
    description: {
      type: Text,
      isRequired: true,
    },
    content: {
      type: Markdown,
      isRequired: false,
    },
    readme: {
      type: Text,
      isRequired: false,
    },
    slug: {
      type: Slug,
      makeUnique: () => true,
      generate: ({ resolvedData }) => slugify(resolvedData.title),
    },
    order: {
      type: Integer,
    },
    isComplete: {
      type: Checkbox,
      defaultValue: false,
    },
  },
};