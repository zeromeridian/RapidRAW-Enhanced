export type TextVariant = 'display' | 'headline' | 'title' | 'heading' | 'subheading' | 'body' | 'label';
export type TextWeight = 'bold' | 'semibold' | 'medium' | 'normal';
export type TextColor = 'primary' | 'secondary';

export const TEXT_WEIGHTS: Record<TextWeight, string> = {
  bold: 'font-bold',
  semibold: 'font-semibold',
  medium: 'font-medium',
  normal: 'font-normal',
};

export const TEXT_COLORS: Record<TextColor, string> = {
  primary: 'text-text-primary',
  secondary: 'text-text-secondary',
};

export interface VariantConfig {
  size: string;
  defaultWeight: TextWeight;
  defaultColor: TextColor;
  defaultElement: React.ElementType;
  extraClasses?: string;
}

export const TEXT_VARIANTS: Record<TextVariant, VariantConfig> = {
  display: {
    size: 'text-5xl',
    defaultWeight: 'bold',
    defaultColor: 'primary',
    defaultElement: 'h1',
    extraClasses: 'text-shadow-shiny',
  },
  headline: {
    size: 'text-2xl',
    defaultWeight: 'bold',
    defaultColor: 'primary',
    defaultElement: 'h1', // check community page as this does not follow current style
    extraClasses: 'text-shadow-shiny',
  },
  title: {
    size: 'text-xl',
    defaultWeight: 'bold',
    defaultColor: 'primary',
    defaultElement: 'h2',
    extraClasses: 'text-shadow-shiny',
  },
  heading: {
    size: 'text-lg',
    defaultWeight: 'semibold',
    defaultColor: 'primary',
    defaultElement: 'h3',
  },
  subheading: {
    size: 'text-md',
    defaultWeight: 'semibold',
    defaultColor: 'primary',
    defaultElement: 'p',
  },
  body: {
    size: 'text-sm',
    defaultWeight: 'normal', //weight used for sm is all over the place
    defaultColor: 'secondary',
    defaultElement: 'p',
  },
  label: {
    size: 'text-xs',
    defaultWeight: 'medium', //CHECK WEIGHTS
    defaultColor: 'secondary',
    defaultElement: 'span',
  },
};
