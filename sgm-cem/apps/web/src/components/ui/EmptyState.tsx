import { Button, Empty, Space, Typography } from 'antd'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div role="status" aria-live="polite">
      <Empty
        image={(
          <Icon
            aria-hidden="true"
            className="size-20 rounded-[20px] border border-[rgba(255,255,255,.06)] bg-[#13261E] p-5 text-[#2ECC71] shadow-[0_8px_30px_rgba(0,0,0,.25)]"
            strokeWidth={1.8}
          />
        )}
        description={(
          <Space direction="vertical" size={8} className="max-w-sm">
            <Typography.Title
              level={3}
              className="!m-0 !font-sans !text-xl !font-semibold !leading-tight !text-white"
            >
              {title}
            </Typography.Title>
            <Typography.Text className="!text-[15px] !leading-relaxed !text-[#94A3B8]">
              {description}
            </Typography.Text>
          </Space>
        )}
      className={cn(
        '!m-0 flex min-h-64 flex-col items-center justify-center rounded-[20px]',
        'border border-[rgba(255,255,255,.06)] bg-[#0E1C16] px-6 py-16 text-center',
        'shadow-[0_8px_30px_rgba(0,0,0,.25)] animate-page-enter',
        '[&_.ant-empty-description]:!mt-5',
        className
      )}
      >
        {onAction && actionLabel && (
          <Button
            type="primary"
            htmlType="button"
            onClick={onAction}
            className={cn(
              '!mt-6 !h-[46px] !rounded-[14px] !border-transparent !px-5 !font-semibold !text-[#07120D]',
              '!bg-[linear-gradient(135deg,#2ECC71_0%,#22C55E_100%)]',
              'shadow-[0_8px_30px_rgba(0,0,0,.25)]',
              'transition-[transform,box-shadow] duration-[250ms]',
              'hover:!-translate-y-0.5 hover:!scale-[1.02] hover:!shadow-[0_20px_40px_rgba(0,0,0,.35)]',
              'active:!translate-y-0 active:!scale-[0.98]'
            )}
          >
            {actionLabel}
          </Button>
        )}
      </Empty>
    </div>
  )
}
