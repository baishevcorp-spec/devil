# Design System

## Компоненты

### Button
- Варианты: primary, secondary, danger
- Размеры: sm (8px 16px), md (12px 24px), lg (16px 32px)
- Состояния: default, hover, active, disabled, loading

### Input
- Варианты: text, password, email, number
- Состояния: default, focus, error, disabled
- Валидация: показывать ошибку под полем

### Modal
- Overlay: rgba(0,0,0,0.5) + backdrop-filter: blur(4px)
- Контент: max-width 600px, padding 24px
- Закрытие: по клику на overlay, по Escape, по крестику

## Иконки
- Использовать SVG-иконки (inline)
- Размер: 16px, 20px, 24px
- Цвет: наследуется от текста

## Анимации
- Появление: fadeIn 200ms ease-in-out
- Исчезновение: fadeOut 150ms ease-in-out
- Hover: scale(1.05) 100ms ease
